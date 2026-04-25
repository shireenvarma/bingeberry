create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text not null default 'New User',
  username text unique not null,
  role text not null default 'team' check (role in ('admin', 'manager', 'team')),
  color text not null default '#6eb5ff',
  calendar_url text not null default '',
  email_reminders boolean not null default true,
  permissions jsonb not null default '{"viewGoals": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'Retainer',
  billing_model text not null default 'retainer',
  industry text not null default '',
  category text not null default '',
  color text not null default '#6eb5ff',
  brief text not null default '',
  guidelines text not null default '',
  strat_day integer not null default 20 check (strat_day between 1 and 28),
  drive text not null default '',
  contact text not null default '',
  email text not null default '',
  fee numeric not null default 0,
  paper_fee numeric not null default 0,
  actual_fee numeric not null default 0,
  project_start_date date,
  project_end_date date,
  timeline jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_assignments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brief text not null default '',
  client_id uuid references public.clients (id) on delete cascade,
  client_ids uuid[] not null default '{}'::uuid[],
  type text not null default 'Retainer',
  start_date date,
  due_date date not null,
  priority text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  slot text not null default 'any' check (slot in ('any', 'first_half', 'second_half')),
  status text not null default 'todo' check (status in ('todo', 'progress', 'review', 'done', 'blocked')),
  assigned_user_id uuid references public.profiles (id) on delete set null,
  assigned_user_ids uuid[] not null default '{}'::uuid[],
  refs text not null default '',
  remind text not null default 'none',
  reminders jsonb not null default '[]'::jsonb,
  recurring boolean not null default false,
  repeat_type text not null default 'none' check (repeat_type in ('none', 'daily', 'weekly', 'monthly')),
  recurring_template_id text,
  cleanup_after_days integer not null default 14,
  source_client_timeline_id text,
  auto_generated boolean not null default false,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_documents (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients add column if not exists billing_model text not null default 'retainer';
alter table public.clients add column if not exists category text not null default '';
alter table public.clients add column if not exists guidelines text not null default '';
alter table public.clients add column if not exists paper_fee numeric not null default 0;
alter table public.clients add column if not exists actual_fee numeric not null default 0;
alter table public.clients add column if not exists project_start_date date;
alter table public.clients add column if not exists project_end_date date;
alter table public.clients add column if not exists timeline jsonb not null default '[]'::jsonb;
alter table public.clients add column if not exists sort_order integer not null default 0;

alter table public.tasks add column if not exists client_ids uuid[] not null default '{}'::uuid[];
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists slot text not null default 'any';
alter table public.tasks add column if not exists assigned_user_ids uuid[] not null default '{}'::uuid[];
alter table public.tasks add column if not exists reminders jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists repeat_type text not null default 'none';
alter table public.tasks add column if not exists cleanup_after_days integer not null default 14;
alter table public.tasks add column if not exists source_client_timeline_id text;
alter table public.tasks add column if not exists auto_generated boolean not null default false;
alter table public.tasks add column if not exists sort_order integer not null default 0;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = uid and role = 'admin'
  );
$$;

create or replace function public.is_manager(uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = uid and role = 'manager'
  );
$$;

create or replace function public.has_client_assignment(target_client_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.client_assignments
    where client_id = target_client_id and user_id = uid
  );
$$;

create or replace function public.has_any_client_assignment(target_client_ids uuid[], uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.client_assignments
    where user_id = uid
      and client_id = any(coalesce(target_client_ids, '{}'::uuid[]))
  );
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if old.id <> auth.uid() then
    raise exception 'Only admins can update other user profiles';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only admins can change roles';
  end if;

  if new.permissions is distinct from old.permissions then
    raise exception 'Only admins can change permissions';
  end if;

  if coalesce(new.email, '') is distinct from coalesce(old.email, '') then
    raise exception 'Update email through authentication settings';
  end if;

  return new;
end;
$$;

create or replace function public.guard_task_update()
returns trigger
language plpgsql
as $$
declare
  old_client_ids uuid[];
  old_assignees uuid[];
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() or public.is_manager() then
    return new;
  end if;

  old_client_ids = case
    when coalesce(array_length(old.client_ids, 1), 0) > 0 then old.client_ids
    when old.client_id is not null then array[old.client_id]
    else '{}'::uuid[]
  end;

  old_assignees = case
    when coalesce(array_length(old.assigned_user_ids, 1), 0) > 0 then old.assigned_user_ids
    when old.assigned_user_id is not null then array[old.assigned_user_id]
    else '{}'::uuid[]
  end;

  if not auth.uid() = any(old_assignees) then
    raise exception 'Only assignees can update this task';
  end if;

  if new.name is distinct from old.name
    or new.brief is distinct from old.brief
    or new.client_id is distinct from old.client_id
    or new.client_ids is distinct from old_client_ids
    or new.type is distinct from old.type
    or new.start_date is distinct from old.start_date
    or new.due_date is distinct from old.due_date
    or new.slot is distinct from old.slot
    or new.assigned_user_id is distinct from old.assigned_user_id
    or new.assigned_user_ids is distinct from old_assignees
    or new.refs is distinct from old.refs
    or new.remind is distinct from old.remind
    or new.reminders is distinct from old.reminders
    or new.recurring is distinct from old.recurring
    or new.repeat_type is distinct from old.repeat_type
    or new.recurring_template_id is distinct from old.recurring_template_id
    or new.cleanup_after_days is distinct from old.cleanup_after_days
    or new.source_client_timeline_id is distinct from old.source_client_timeline_id
    or new.auto_generated is distinct from old.auto_generated
  then
    raise exception 'Team members can only update status, priority, and ordering';
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_count integer;
begin
  select count(*) into profile_count from public.profiles;

  insert into public.profiles (
    id,
    email,
    full_name,
    username,
    role,
    color,
    permissions
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'New User'),
    lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9._-]', '', 'g')),
    case when profile_count = 0 then 'admin' else 'team' end,
    coalesce(new.raw_user_meta_data ->> 'color', '#6eb5ff'),
    case when profile_count = 0 then '{"viewGoals": true}'::jsonb else '{"viewGoals": false}'::jsonb end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.handle_updated_at();

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
before update on public.profiles
for each row execute function public.guard_profile_update();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.handle_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.handle_updated_at();

drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update
before update on public.tasks
for each row execute function public.guard_task_update();

drop trigger if exists workspace_documents_set_updated_at on public.workspace_documents;
create trigger workspace_documents_set_updated_at
before update on public.workspace_documents
for each row execute function public.handle_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

update public.clients
set
  billing_model = case
    when type ilike '%project%' or type ilike '%branding%' or type ilike '%adhoc%' then 'project'
    else 'retainer'
  end
where billing_model is null or billing_model = '';

update public.clients
set
  paper_fee = case when coalesce(paper_fee, 0) = 0 then coalesce(fee, 0) else paper_fee end,
  actual_fee = case when coalesce(actual_fee, 0) = 0 then coalesce(fee, 0) else actual_fee end
where coalesce(fee, 0) <> 0;

update public.clients
set sort_order = ranked.position
from (
  select id, row_number() over (order by created_at, name) as position
  from public.clients
) ranked
where ranked.id = public.clients.id
  and coalesce(public.clients.sort_order, 0) = 0;

update public.tasks
set client_ids = case when client_id is null then '{}'::uuid[] else array[client_id] end
where coalesce(array_length(client_ids, 1), 0) = 0;

update public.tasks
set assigned_user_ids = case when assigned_user_id is null then '{}'::uuid[] else array[assigned_user_id] end
where coalesce(array_length(assigned_user_ids, 1), 0) = 0;

update public.tasks
set reminders = case
  when remind is null or remind = '' or remind = 'none' then '[]'::jsonb
  when jsonb_typeof(reminders) = 'array' and jsonb_array_length(reminders) > 0 then reminders
  else jsonb_build_array(jsonb_build_object('daysBefore', (remind)::integer, 'time', '10:00'))
end
where reminders is null or reminders = '[]'::jsonb;

update public.tasks
set repeat_type = case when recurring then 'monthly' else 'none' end
where repeat_type is null or repeat_type = '';

update public.tasks
set sort_order = ranked.position
from (
  select id, row_number() over (order by due_date, created_at, name) as position
  from public.tasks
) ranked
where ranked.id = public.tasks.id
  and coalesce(public.tasks.sort_order, 0) = 0;

create index if not exists clients_sort_order_idx on public.clients (sort_order);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_repeat_type_idx on public.tasks (repeat_type);
create index if not exists tasks_sort_order_idx on public.tasks (sort_order);
create index if not exists tasks_client_ids_gin on public.tasks using gin (client_ids);
create index if not exists tasks_assigned_user_ids_gin on public.tasks using gin (assigned_user_ids);

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;
alter table public.tasks enable row level security;
alter table public.workspace_documents enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "clients_select_authenticated" on public.clients;
create policy "clients_select_authenticated"
on public.clients
for select
to authenticated
using (true);

drop policy if exists "clients_write_admin_or_manager" on public.clients;
create policy "clients_write_admin_or_manager"
on public.clients
for all
to authenticated
using (public.is_admin() or public.is_manager())
with check (public.is_admin() or public.is_manager());

drop policy if exists "client_assignments_select_authenticated" on public.client_assignments;
create policy "client_assignments_select_authenticated"
on public.client_assignments
for select
to authenticated
using (true);

drop policy if exists "client_assignments_write_admin" on public.client_assignments;
create policy "client_assignments_write_admin"
on public.client_assignments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "tasks_select_by_role" on public.tasks;
create policy "tasks_select_by_role"
on public.tasks
for select
to authenticated
using (
  public.is_admin()
  or auth.uid() = any(coalesce(assigned_user_ids, '{}'::uuid[]))
  or (public.is_manager() and public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[])))
);

drop policy if exists "tasks_insert_by_role" on public.tasks;
create policy "tasks_insert_by_role"
on public.tasks
for insert
to authenticated
with check (
  public.is_admin()
  or (public.is_manager() and public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[])))
  or (
    auth.uid() = any(coalesce(assigned_user_ids, '{}'::uuid[]))
    and coalesce(array_length(assigned_user_ids, 1), 0) = 1
    and (
      coalesce(array_length(client_ids, 1), 0) = 0
      or public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[]))
    )
  )
);

drop policy if exists "tasks_update_by_role" on public.tasks;
create policy "tasks_update_by_role"
on public.tasks
for update
to authenticated
using (
  public.is_admin()
  or auth.uid() = any(coalesce(assigned_user_ids, '{}'::uuid[]))
  or (public.is_manager() and public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[])))
)
with check (
  public.is_admin()
  or auth.uid() = any(coalesce(assigned_user_ids, '{}'::uuid[]))
  or (public.is_manager() and public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[])))
);

drop policy if exists "tasks_delete_admin_or_manager" on public.tasks;
create policy "tasks_delete_admin_or_manager"
on public.tasks
for delete
to authenticated
using (
  public.is_admin()
  or (public.is_manager() and public.has_any_client_assignment(coalesce(client_ids, '{}'::uuid[])))
);

drop policy if exists "workspace_docs_select_authenticated" on public.workspace_documents;
create policy "workspace_docs_select_authenticated"
on public.workspace_documents
for select
to authenticated
using (true);

drop policy if exists "workspace_docs_write_by_role" on public.workspace_documents;
create policy "workspace_docs_write_by_role"
on public.workspace_documents
for all
to authenticated
using (
  public.is_admin()
  or (public.is_manager() and key in ('recurring_templates', 'monthly_checklist_definition'))
  or key = 'monthly_checklist_state'
)
with check (
  public.is_admin()
  or (public.is_manager() and key in ('recurring_templates', 'monthly_checklist_definition'))
  or key = 'monthly_checklist_state'
);
