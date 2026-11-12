begin;

-- Supersede the Board archive migration, including previously archived tasks.
-- Preserve the RPC name used by the existing hourly database job.
create or replace function public.purge_expired_completed_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare deleted_count integer;
begin
  with deleted as (
    delete from public.tasks
    where status = 'done'
      and completed_at <= now() - interval '24 hours'
    returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end; $$;
revoke all on function public.purge_expired_completed_tasks() from public, authenticated, anon;
grant execute on function public.purge_expired_completed_tasks() to service_role;

select cron.schedule('purge_expired_completed_tasks_hourly', '5 * * * *', 'select public.purge_expired_completed_tasks()')
where not exists (select 1 from cron.job where jobname = 'purge_expired_completed_tasks_hourly');

commit;
notify pgrst, 'reload schema';
