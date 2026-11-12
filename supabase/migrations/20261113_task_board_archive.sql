begin;

alter table public.tasks add column if not exists archived_at timestamptz;
create index if not exists tasks_archive_idx on public.tasks(archived_at);

create or replace function public.set_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'done' then
    new.completed_at = null;
    new.archived_at = null;
  elsif tg_op = 'INSERT' then
    new.completed_at = now();
    new.archived_at = null;
  elsif old.status is distinct from 'done' then
    new.completed_at = now();
    new.archived_at = null;
  else
    new.completed_at = old.completed_at;
  end if;
  return new;
end; $$;
drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at before insert or update on public.tasks
for each row execute function public.set_task_completed_at();

-- Keep the existing RPC and hourly cron target, but never delete completed work.
create or replace function public.purge_expired_completed_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare archived_count integer;
begin
  with archived as (
    update public.tasks set archived_at = now()
    where status = 'done' and archived_at is null
      and completed_at <= now() - interval '24 hours'
    returning 1
  ) select count(*) into archived_count from archived;
  return archived_count;
end; $$;
revoke all on function public.purge_expired_completed_tasks() from public;
revoke all on function public.purge_expired_completed_tasks() from authenticated;
grant execute on function public.purge_expired_completed_tasks() to service_role;

commit;
notify pgrst, 'reload schema';
