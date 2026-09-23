-- Retain completed tasks for 24 hours, then permanently delete them.
alter table public.tasks add column if not exists completed_at timestamptz;

-- Existing completed tasks have no historical completion timestamp. Start their 24-hour
-- retention window from their most recent update when this migration is first applied.
update public.tasks
set completed_at = updated_at
where status = 'done' and completed_at is null;

create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at
before insert or update of status on public.tasks
for each row execute function public.set_task_completed_at();

create or replace function public.purge_expired_completed_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  with deleted as (
    delete from public.tasks
    where status = 'done'
      and completed_at <= now() - interval '24 hours'
    returning 1
  )
  select count(*) into deleted_count from deleted;

  return deleted_count;
end;
$$;

notify pgrst, 'reload schema';

revoke all on function public.purge_expired_completed_tasks() from public;
grant execute on function public.purge_expired_completed_tasks() to authenticated;

-- The hourly schedule keeps working even when nobody has the dashboard open.
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge_expired_completed_tasks_hourly') then
    perform cron.schedule(
      'purge_expired_completed_tasks_hourly',
      '5 * * * *',
      'select public.purge_expired_completed_tasks()'
    );
  end if;
end;
$$;
