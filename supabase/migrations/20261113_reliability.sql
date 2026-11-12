begin;

-- Existing accounts remain active. New signups need an admin's approval.
alter table public.profiles add column if not exists approved boolean;
update public.profiles set approved = true where approved is null;
alter table public.profiles alter column approved set default false;
alter table public.profiles alter column approved set not null;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and approved); $$;

create or replace function public.can_view_finance()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and approved
  and (role = 'admin' or coalesce((permissions->>'viewGoals')::boolean, false))); $$;

create or replace function public.guard_profile_access()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op='INSERT' and new.role='admin' and auth.uid() is null then new.approved:=true; end if;
  if tg_op='UPDATE' and auth.uid() is not null and old.role='admin' and old.approved
  and (new.role<>'admin' or not new.approved) then
    perform pg_advisory_xact_lock(hashtextextended('team_roles',0));
    if (select count(*) from profiles where role='admin' and approved)=1 then raise exception 'Keep at least one approved administrator'; end if;
  end if;
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.role <> 'team' or new.approved or new.permissions <> '{"viewGoals":false}'::jsonb then
        raise exception 'Only admins can grant access';
      end if;
    elsif new.approved is distinct from old.approved then
      raise exception 'Only admins can approve accounts';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_guard_access on public.profiles;
create trigger profiles_guard_access before insert or update on public.profiles
for each row execute function public.guard_profile_access();

-- Restrictive policies apply to all existing permissive write/read policies.
do $$ declare tab text; begin
  foreach tab in array array['clients','tasks','workspace_documents','client_assignments'] loop
    execute format('drop policy if exists approved_members_only on public.%I',tab);
    execute format('create policy approved_members_only on public.%I as restrictive for all to authenticated using (public.is_member()) with check (public.is_member())',tab);
  end loop;
end; $$;
drop policy if exists approved_profiles_only on public.profiles;
create policy approved_profiles_only on public.profiles as restrictive for all to authenticated
using (id = auth.uid() or public.is_member()) with check (id = auth.uid() or public.is_member());

drop policy if exists clients_write_admin_or_manager on public.clients;
drop policy if exists clients_insert_managers on public.clients;
drop policy if exists clients_update_managers on public.clients;
drop policy if exists clients_delete_admin on public.clients;
create policy clients_insert_managers on public.clients for insert to authenticated with check (public.is_admin() or public.is_manager());
create policy clients_update_managers on public.clients for update to authenticated using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());
create policy clients_delete_admin on public.clients for delete to authenticated using (public.is_admin());

-- Public brand metadata remains readable, financial columns do not.
revoke select on public.clients from anon, authenticated;
grant select(id,name,type,billing_model,industry,category,color,brief,guidelines,strat_day,
 drive,contact,email,project_start_date,project_end_date,timeline,sort_order,created_at,updated_at)
on public.clients to authenticated;
create or replace function public.client_finances()
returns table(id uuid, fee numeric, paper_fee numeric, actual_fee numeric)
language sql stable security definer set search_path = public as $$
  select id,fee,paper_fee,actual_fee from clients where public.can_view_finance();
$$;
drop policy if exists workspace_docs_select_authenticated on public.workspace_documents;
create policy workspace_docs_select_authenticated on public.workspace_documents for select to authenticated using (
  key in ('recurring_templates','monthly_checklist_definition','monthly_checklist_state')
  or (key = 'business_goals' and public.can_view_finance()) or public.is_admin());
drop policy if exists workspace_docs_write_by_role on public.workspace_documents;
drop policy if exists workspace_docs_insert on public.workspace_documents;
drop policy if exists workspace_docs_update on public.workspace_documents;
drop policy if exists workspace_docs_delete on public.workspace_documents;
create policy workspace_docs_insert on public.workspace_documents for insert to authenticated with check (
 public.is_admin() or (public.is_manager() and key in ('recurring_templates','monthly_checklist_definition')) or key='monthly_checklist_state');
create policy workspace_docs_update on public.workspace_documents for update to authenticated using (
 public.is_admin() or (public.is_manager() and key in ('recurring_templates','monthly_checklist_definition')) or key='monthly_checklist_state') with check (
 public.is_admin() or (public.is_manager() and key in ('recurring_templates','monthly_checklist_definition')) or key='monthly_checklist_state');
create policy workspace_docs_delete on public.workspace_documents for delete to authenticated using (public.is_admin());

create or replace function public.set_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'done' then new.completed_at = null;
  elsif tg_op = 'INSERT' then new.completed_at = now();
  elsif old.status is distinct from 'done' then new.completed_at = now();
  else new.completed_at = old.completed_at;
  end if;
  return new;
end; $$;
drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at before insert or update on public.tasks
for each row execute function public.set_task_completed_at();
create index if not exists tasks_completed_expiry_idx on public.tasks(completed_at) where status='done';

-- Compare-and-swap protects shared JSON documents from lost updates.
create or replace function public.save_workspace_document(p_key text,p_value jsonb,p_expected timestamptz)
returns timestamptz language plpgsql security invoker set search_path = public as $$
declare current_version timestamptz; next_version timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key,0));
  if p_key in ('recurring_templates','business_goals') and jsonb_typeof(p_value)<>'array' then raise exception 'Invalid workspace document'; end if;
  select updated_at into current_version from workspace_documents where key=p_key for update;
  if current_version is distinct from p_expected then raise exception 'Workspace changed. Refresh and retry your edit.'; end if;
  insert into workspace_documents(key,value) values(p_key,p_value)
  on conflict(key) do update set value=excluded.value returning updated_at into next_version;
  return next_version;
end; $$;

create or replace function public.set_checklist_item(p_key text,p_checked boolean)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into workspace_documents(key,value) values('monthly_checklist_state',jsonb_build_object(p_key,p_checked))
  on conflict(key) do update set value=workspace_documents.value || jsonb_build_object(p_key,p_checked);
end; $$;

-- One transaction saves a task and its optional recurrence definition.
create or replace function public.save_task(p_task jsonb,p_expected timestamptz default null,p_template jsonb default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare t public.tasks; existing public.tasks; definition jsonb;
begin
  t := jsonb_populate_record(null::public.tasks,p_task);
  perform pg_advisory_xact_lock(hashtextextended(t.id::text,0));
  select * into existing from tasks where id=t.id for update;
  if existing.id is null and p_expected is not null then raise exception 'Task was deleted. Refresh before saving.'; end if;
  if found and existing.updated_at is distinct from p_expected then raise exception 'Task changed. Refresh before saving.'; end if;
  if existing.id is null then
    insert into tasks(id,name,brief,client_id,client_ids,type,start_date,due_date,priority,slot,status,
      assigned_user_id,assigned_user_ids,refs,remind,reminders,recurring,repeat_type,recurring_template_id,
      sort_order,updated_by)
    values(t.id,t.name,coalesce(t.brief,''),t.client_id,coalesce(t.client_ids,'{}'),t.type,t.start_date,t.due_date,t.priority,t.slot,t.status,
      t.assigned_user_id,coalesce(t.assigned_user_ids,'{}'),coalesce(t.refs,''),coalesce(t.remind,'none'),coalesce(t.reminders,'[]'),
      coalesce(t.recurring,false),coalesce(t.repeat_type,'none'),t.recurring_template_id,coalesce(t.sort_order,0),auth.uid());
  else
    update tasks set name=t.name,brief=t.brief,client_id=t.client_id,client_ids=t.client_ids,type=t.type,start_date=t.start_date,
      due_date=t.due_date,priority=t.priority,slot=t.slot,status=t.status,assigned_user_id=t.assigned_user_id,
      assigned_user_ids=t.assigned_user_ids,refs=t.refs,remind=t.remind,reminders=t.reminders,recurring=t.recurring,
      repeat_type=t.repeat_type,recurring_template_id=t.recurring_template_id,updated_by=auth.uid() where id=t.id;
    if not found then raise exception 'Task is no longer editable'; end if;
  end if;
  if p_template is not null then
    perform pg_advisory_xact_lock(hashtextextended('recurring_templates',0));
    select value into definition from workspace_documents where key='recurring_templates' for update;
    select coalesce(jsonb_agg(value),'[]') into definition from jsonb_array_elements(coalesce(definition,'[]')) where value->>'id' <> p_template->>'id';
    insert into workspace_documents(key,value) values('recurring_templates',definition || jsonb_build_array(p_template))
    on conflict(key) do update set value=excluded.value;
  elsif existing.recurring_template_id is not null and t.recurring_template_id is null then
    perform pg_advisory_xact_lock(hashtextextended('recurring_templates',0));
    update workspace_documents set value=(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(workspace_documents.value) where value->>'id'<>existing.recurring_template_id) where key='recurring_templates';
  end if;
  return t.id;
end; $$;

-- A retained occurrence ledger prevents regeneration after completed tasks are purged.
create table if not exists public.task_occurrences (
 template_id text not null, due_date date not null, primary key(template_id,due_date));
alter table public.task_occurrences enable row level security;
insert into public.task_occurrences select distinct recurring_template_id,due_date from tasks where recurring_template_id is not null on conflict do nothing;
create or replace function public.record_task_occurrence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.recurring_template_id is not null then
   if tg_op='INSERT' or new.recurring_template_id is distinct from old.recurring_template_id or new.due_date is distinct from old.due_date then
     insert into task_occurrences values(new.recurring_template_id,new.due_date);
   end if;
 end if;
 return new;
end; $$;
drop trigger if exists tasks_record_occurrence on public.tasks;
create trigger tasks_record_occurrence before insert or update on public.tasks for each row execute function public.record_task_occurrence();

create or replace function public.generate_recurring_tasks()
returns integer language plpgsql security definer set search_path=public as $$
declare template jsonb; due date; anchor date; current_day date := (now() at time zone 'Asia/Kolkata')::date; added integer:=0;
begin
 if auth.uid() is not null and not (public.is_member() and (public.is_admin() or public.is_manager())) then raise exception 'Not permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended('generate_recurring_tasks',0));
 for template in select jsonb_array_elements(value) from workspace_documents where key='recurring_templates' loop
  begin
  anchor := (template->>'anchorDate')::date;
  if anchor is null then continue; end if;
  if template->>'repeatType'='daily' then due:=current_day;
  elsif template->>'repeatType'='weekly' then due:=current_day+(extract(dow from anchor)::integer-extract(dow from current_day)::integer);
  elsif template->>'repeatType'='monthly' then due:=date_trunc('month',current_day)::date + (least(extract(day from anchor)::integer,extract(day from date_trunc('month',current_day)+interval '1 month - 1 day')::integer)-1);
  else continue; end if;
  if due<anchor or exists(select 1 from task_occurrences where template_id=template->>'id' and due_date=due) then continue; end if;
  insert into tasks(name,brief,client_id,client_ids,type,due_date,priority,slot,assigned_user_id,assigned_user_ids,reminders,repeat_type,recurring,recurring_template_id)
  values(template->>'name',coalesce(template->>'brief',''),nullif(template->'clientIds'->>0,'')::uuid,
    array(select jsonb_array_elements_text(coalesce(template->'clientIds','[]')))::uuid[],template->>'type',due,coalesce(template->>'priority','Medium'),coalesce(template->>'slot','any'),
    nullif(template->'assignedIds'->>0,'')::uuid,array(select jsonb_array_elements_text(coalesce(template->'assignedIds','[]')))::uuid[],coalesce(template->'reminders','[]'),template->>'repeatType',true,template->>'id');
  added:=added+1;
  exception when data_exception or integrity_constraint_violation or raise_exception then
    raise warning 'Recurring template % needs correction: %',template->>'id',sqlerrm;
  end;
 end loop;
 return added;
end; $$;

-- Reorder only the requested, editable scope; reject before making any writes.
create or replace function public.reorder_tasks(p_ids uuid[])
returns void language plpgsql security invoker set search_path=public as $$
declare task_id uuid; position integer:=0;
begin
 if cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) id) then raise exception 'Duplicate task IDs'; end if;
 perform pg_advisory_xact_lock(hashtextextended('task_order',0));
 foreach task_id in array p_ids loop
  position:=position+1;
  update tasks set sort_order=position where id=task_id;
  if not found then raise exception 'Task no longer editable. Refresh and retry.'; end if;
 end loop;
end; $$;

create or replace function public.save_team_member(p_id uuid,p_profile jsonb,p_clients uuid[])
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Only admins can manage team members'; end if;
 perform pg_advisory_xact_lock(hashtextextended('team_roles',0));
 perform 1 from profiles where id=p_id for update;
 if not found then raise exception 'Team member no longer exists'; end if;
 if (select updated_at from profiles where id=p_id) is distinct from (p_profile->>'expected_version')::timestamptz then raise exception 'Team member changed. Refresh before saving.'; end if;
 if exists(select 1 from profiles where id=p_id and role='admin' and approved)
 and (p_profile->>'role'<>'admin' or not (p_profile->>'approved')::boolean)
 and (select count(*) from profiles where role='admin' and approved)=1 then raise exception 'Keep at least one approved administrator'; end if;
 update profiles set full_name=p_profile->>'full_name',username=p_profile->>'username',role=p_profile->>'role',
 color=p_profile->>'color',email_reminders=(p_profile->>'email_reminders')::boolean,permissions=p_profile->'permissions',approved=(p_profile->>'approved')::boolean where id=p_id;
 delete from client_assignments where user_id=p_id;
 insert into client_assignments select p_id,unnest(p_clients);
end; $$;

-- Prevent finance writes by roles that cannot see financial data.
create or replace function public.guard_client_finance()
returns trigger language plpgsql as $$
begin
 if auth.uid() is not null and not public.is_admin() then
  if tg_op='INSERT' then
   if new.fee<>0 or new.paper_fee<>0 or new.actual_fee<>0 then raise exception 'Only admins can change financial values'; end if;
  elsif (new.fee,new.paper_fee,new.actual_fee) is distinct from (old.fee,old.paper_fee,old.actual_fee) then raise exception 'Only admins can change financial values'; end if;
 end if;
 return new;
end; $$;
drop trigger if exists clients_guard_finance on public.clients;
create trigger clients_guard_finance before insert or update on public.clients for each row execute function public.guard_client_finance();

create or replace function public.validate_task_inputs()
returns trigger language plpgsql as $$
declare reminder jsonb;
begin
 if btrim(new.name)='' or btrim(new.type)='' then raise exception 'Task name and type are required'; end if;
 if new.start_date>new.due_date then raise exception 'Due date must follow start date'; end if;
 if jsonb_typeof(new.reminders)<>'array' then raise exception 'Invalid reminders'; end if;
 for reminder in select jsonb_array_elements(new.reminders) loop
  if coalesce(reminder->>'daysBefore','') !~ '^\d{1,4}$' or coalesce(reminder->>'time','') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Invalid reminder date or time'; end if;
 end loop;
 return new;
end; $$;
drop trigger if exists tasks_validate_inputs on public.tasks;
create trigger tasks_validate_inputs before insert or update on public.tasks for each row execute function public.validate_task_inputs();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare first_account boolean; chosen_username text;
begin
 perform pg_advisory_xact_lock(hashtextextended('signup_profiles',0));
 first_account := not exists(select 1 from profiles);
 chosen_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username',split_part(new.email,'@',1),'user'),'[^a-zA-Z0-9._-]','','g'));
 if chosen_username='' then chosen_username:='user'; end if;
 if exists(select 1 from profiles where username=chosen_username) then chosen_username:=chosen_username||'-'||new.id::text; end if;
 insert into profiles(id,email,full_name,username,role,color,permissions,approved)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1),'New User'),chosen_username,
 case when first_account then 'admin' else 'team' end,coalesce(new.raw_user_meta_data->>'color','#6eb5ff'),jsonb_build_object('viewGoals',first_account),first_account)
 on conflict(id) do nothing;
 return new;
end; $$;

create table if not exists public.timeline_occurrences(client_id uuid references public.clients(id) on delete cascade,milestone_id text,primary key(client_id,milestone_id));
alter table public.timeline_occurrences enable row level security;
insert into public.timeline_occurrences select distinct client_id,source_client_timeline_id from tasks where client_id is not null and source_client_timeline_id is not null on conflict do nothing;

create or replace function public.save_client(p_client jsonb,p_expected timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare c clients; previous clients; item jsonb; old_item jsonb; existing tasks; assignees uuid[];
begin
 if not(public.is_member() and (public.is_admin() or public.is_manager())) then raise exception 'Not permitted'; end if;
 c:=jsonb_populate_record(null::clients,p_client);
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,0));
 select * into previous from clients where id=c.id for update;
 if previous.id is not null and previous.updated_at is distinct from p_expected then raise exception 'Brand changed. Refresh before saving.'; end if;
 if not public.is_admin() and (p_client ? 'fee' or p_client ? 'paper_fee' or p_client ? 'actual_fee') then raise exception 'Only admins can edit finances'; end if;
 if c.project_end_date<c.project_start_date then raise exception 'Project end must follow start'; end if;
 insert into clients(id,name,type,billing_model,industry,category,color,brief,guidelines,strat_day,drive,contact,email,fee,paper_fee,actual_fee,project_start_date,project_end_date,timeline,sort_order)
 values(c.id,c.name,c.type,c.billing_model,c.industry,c.category,c.color,c.brief,c.guidelines,c.strat_day,c.drive,c.contact,c.email,
 coalesce(c.fee,previous.fee,0),coalesce(c.paper_fee,previous.paper_fee,0),coalesce(c.actual_fee,previous.actual_fee,0),c.project_start_date,c.project_end_date,coalesce(c.timeline,'[]'),coalesce(c.sort_order,0))
 on conflict(id) do update set name=excluded.name,type=excluded.type,billing_model=excluded.billing_model,industry=excluded.industry,
 category=excluded.category,color=excluded.color,brief=excluded.brief,guidelines=excluded.guidelines,strat_day=excluded.strat_day,drive=excluded.drive,
 contact=excluded.contact,email=excluded.email,fee=excluded.fee,paper_fee=excluded.paper_fee,actual_fee=excluded.actual_fee,
 project_start_date=excluded.project_start_date,project_end_date=excluded.project_end_date,timeline=excluded.timeline;
 for item in select jsonb_array_elements(coalesce(c.timeline,'[]')) loop
  select value into old_item from jsonb_array_elements(coalesce(previous.timeline,'[]')) where value->>'id'=item->>'id';
  select * into existing from tasks where client_id=c.id and source_client_timeline_id=item->>'id' for update;
  assignees:=array(select jsonb_array_elements_text(coalesce(item->'assignedIds','[]')))::uuid[];
  if existing.id is not null then
   -- Update only milestone fields actually edited, preserving independent task edits.
   update tasks set name=case when item->>'title' is distinct from old_item->>'title' then item->>'title' else name end,
    brief=case when item->>'brief' is distinct from old_item->>'brief' then coalesce(item->>'brief','') else brief end,
    due_date=case when item->>'date' is distinct from old_item->>'date' then (item->>'date')::date else due_date end,
    assigned_user_ids=case when item->'assignedIds' is distinct from old_item->'assignedIds' then assignees else assigned_user_ids end,
    assigned_user_id=case when item->'assignedIds' is distinct from old_item->'assignedIds' then assignees[1] else assigned_user_id end
   where id=existing.id and item is distinct from old_item;
  elsif not exists(select 1 from timeline_occurrences where client_id=c.id and milestone_id=item->>'id') then
   insert into timeline_occurrences values(c.id,item->>'id');
   insert into tasks(name,brief,client_id,client_ids,type,due_date,assigned_user_id,assigned_user_ids,source_client_timeline_id,auto_generated)
   values(item->>'title',coalesce(item->>'brief',''),c.id,array[c.id],c.type,(item->>'date')::date,assignees[1],assignees,item->>'id',true);
  end if;
 end loop;
 delete from tasks where client_id=c.id and source_client_timeline_id is not null
 and not exists(select 1 from jsonb_array_elements(coalesce(c.timeline,'[]')) where value->>'id'=tasks.source_client_timeline_id);
 return c.id;
end; $$;
revoke all on function public.save_client(jsonb,timestamptz) from public;
grant execute on function public.save_client(jsonb,timestamptz) to authenticated;

create or replace function public.delete_recurring_template(p_id text,p_expected timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare remaining jsonb; total integer; removed integer;
begin
 if not (public.is_admin() or public.is_manager()) then raise exception 'Not permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended('generate_recurring_tasks',0));
 select coalesce(jsonb_agg(e.value),'[]') into remaining from workspace_documents d,
 lateral jsonb_array_elements(d.value) e(value) where d.key='recurring_templates' and e.value->>'id'<>p_id;
 perform public.save_workspace_document('recurring_templates',remaining,p_expected);
 select count(*) into total from tasks where recurring_template_id=p_id;
 delete from tasks where recurring_template_id=p_id;
 get diagnostics removed=row_count;
 if total<>removed then raise exception 'Ask an administrator to remove this template and its tasks'; end if;
end; $$;

create or replace function public.reset_workspace()
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Only admins can reset the workspace'; end if;
 delete from tasks; delete from clients; delete from client_assignments;
 delete from workspace_documents where key in ('recurring_templates','business_goals','monthly_checklist_state','monthly_checklist_definition','settings');
end; $$;

create or replace function public.reorder_clients(p_ids uuid[])
returns void language plpgsql security invoker set search_path=public as $$
declare client_id uuid; position integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('client_order',0));
 foreach client_id in array p_ids loop
  position:=position+1;
  update clients set sort_order=position where id=client_id;
  if not found then raise exception 'Brand no longer editable. Refresh and retry.'; end if;
 end loop;
end; $$;
revoke all on function public.delete_recurring_template(text,timestamptz),public.reset_workspace(),public.reorder_clients(uuid[]) from public;
grant execute on function public.delete_recurring_template(text,timestamptz),public.reset_workspace(),public.reorder_clients(uuid[]) to authenticated;

-- Pin down RPC grants; no anonymous access to mutation or financial functions.
revoke all on function public.client_finances(),public.save_task(jsonb,timestamptz,jsonb),public.reorder_tasks(uuid[]),public.save_team_member(uuid,jsonb,uuid[]),public.save_workspace_document(text,jsonb,timestamptz),public.set_checklist_item(text,boolean),public.generate_recurring_tasks() from public;
grant execute on function public.client_finances(),public.save_task(jsonb,timestamptz,jsonb),public.reorder_tasks(uuid[]),public.save_team_member(uuid,jsonb,uuid[]),public.save_workspace_document(text,jsonb,timestamptz),public.set_checklist_item(text,boolean),public.generate_recurring_tasks() to authenticated,service_role;

select cron.schedule('bingeberry-recurring','*/15 * * * *','select public.generate_recurring_tasks()')
where not exists(select 1 from cron.job where jobname='bingeberry-recurring');
commit;
notify pgrst, 'reload schema';
