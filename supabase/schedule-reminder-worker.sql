-- Run after deploying task-reminders and adding these secrets to Supabase Vault:
-- bingeberry_reminder_worker_url: https://PROJECT.supabase.co/functions/v1/task-reminders
-- bingeberry_reminder_worker_token: the same value as REMINDER_CRON_SECRET
create extension if not exists pg_net with schema extensions;
select cron.schedule('bingeberry-reminder-worker','* * * * *',$job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='bingeberry_reminder_worker_url'),
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
     (select decrypted_secret from vault.decrypted_secrets where name='bingeberry_reminder_worker_token')),
   body := '{}'::jsonb
 );
$job$)
where not exists(select 1 from cron.job where jobname='bingeberry-reminder-worker');
