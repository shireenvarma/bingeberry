-- Authenticated teammates may read all tasks. Write policies remain unchanged.
begin;
drop policy if exists "tasks_select_by_role" on public.tasks;
create policy "tasks_select_by_role"
on public.tasks for select to authenticated using (true);
commit;
notify pgrst, 'reload schema';
