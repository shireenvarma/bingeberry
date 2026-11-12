begin;
create table if not exists public.reminder_deliveries(
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 reminder_key text not null, scheduled_at timestamptz not null,
 attempts integer not null default 0, lease_until timestamptz,
 sent_at timestamptz, last_error text,
 unique(task_id,user_id,reminder_key));
alter table public.reminder_deliveries enable row level security;
create index if not exists reminder_pending on public.reminder_deliveries(scheduled_at) where sent_at is null;

create or replace function public.enqueue_task_reminders()
returns void language sql security definer set search_path=public as $$
 insert into reminder_deliveries(task_id,user_id,reminder_key,scheduled_at)
 select t.id,p.id,concat(t.due_date,'/',r->>'daysBefore','/',r->>'time'),
 ((t.due_date - (r->>'daysBefore')::integer) + (r->>'time')::time) at time zone 'Asia/Kolkata'
 from tasks t cross join lateral jsonb_array_elements(t.reminders) r
 join profiles p on p.id=any(t.assigned_user_ids) and p.email_reminders and p.approved
 where t.status<>'done' and r->>'daysBefore' ~ '^\d{1,4}$' and r->>'time' ~ '^([01]\d|2[0-3]):[0-5]\d$'
 and ((t.due_date - (r->>'daysBefore')::integer) + (r->>'time')::time) at time zone 'Asia/Kolkata' between now()-interval '15 minutes' and now()
 on conflict do nothing;
$$;

create or replace function public.claim_task_reminders()
returns table(id uuid,email text,task_name text,due_date date,attempt integer)
language plpgsql security definer set search_path=public as $$
begin
 perform enqueue_task_reminders();
 return query
 with picked as (
 select d.id from reminder_deliveries d join tasks t on t.id=d.task_id join profiles p on p.id=d.user_id
 where d.sent_at is null and d.scheduled_at<=now() and d.attempts<5 and coalesce(d.lease_until,'-infinity')<now()
 and t.status<>'done' and p.approved and p.email_reminders
 and p.id=any(t.assigned_user_ids)
 and exists(select 1 from jsonb_array_elements(t.reminders) r where concat(t.due_date,'/',r->>'daysBefore','/',r->>'time')=d.reminder_key)
 order by d.scheduled_at for update of d skip locked limit 10
 ), claimed as (
 update reminder_deliveries d set lease_until=now()+interval '5 minutes',attempts=d.attempts+1
 from picked where d.id=picked.id returning d.*)
 select c.id,p.email,t.name,t.due_date,c.attempts from claimed c join profiles p on p.id=c.user_id join tasks t on t.id=c.task_id;
end; $$;

create or replace function public.finish_task_reminder(p_id uuid,p_attempt integer,p_error text default null)
returns void language sql security definer set search_path=public as $$
 update reminder_deliveries set sent_at=case when p_error is null then now() else null end,
 last_error=left(p_error,500),lease_until=now()+interval '5 minutes'
 where id=p_id and attempts=p_attempt and sent_at is null;
$$;
revoke all on function public.enqueue_task_reminders(),public.claim_task_reminders(),public.finish_task_reminder(uuid,integer,text) from public;
grant execute on function public.enqueue_task_reminders(),public.claim_task_reminders(),public.finish_task_reminder(uuid,integer,text) to service_role;
select cron.schedule('bingeberry-reminders','* * * * *','select public.enqueue_task_reminders()')
where not exists(select 1 from cron.job where jobname='bingeberry-reminders');
commit;
notify pgrst,'reload schema';
