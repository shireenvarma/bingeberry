import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const admin='10000000-0000-0000-0000-000000000001';
const team='10000000-0000-0000-0000-000000000002';
const manager='10000000-0000-0000-0000-000000000003';
const brand='20000000-0000-0000-0000-000000000001';
const taskId='30000000-0000-0000-0000-000000000001';

test('migrations, access boundaries and transactional task operations', async () => {
 const db=new PGlite();
 try {
 await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create schema cron; create table cron.job(jobname text);
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ begin insert into cron.job values($1); return 1; end $$;`);
 const schema=(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8')).replace(/^create extension.*;$/gm,'');
 await db.exec(schema);
 await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
 ('${admin}','admin@example.com','{"username":"admin"}'),('${team}','team@example.com','{"username":"team"}'),('${manager}','manager@example.com','{"username":"manager"}');
 update profiles set role='manager' where id='${manager}';
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant all on all tables in schema public to authenticated,anon,service_role;
 grant execute on all functions in schema public,auth to authenticated,anon,service_role;`);
 const migration=await readFile(new URL('../supabase/migrations/20261113_reliability.sql',import.meta.url),'utf8');
 await db.exec(migration);
 await db.exec(migration); // Migration must be rerunnable.
 const reminders=await readFile(new URL('../supabase/migrations/20261113_reminders.sql',import.meta.url),'utf8');
 await db.exec(reminders);
 await db.exec(reminders);
 const boardArchive=await readFile(new URL('../supabase/migrations/20261113_task_board_archive.sql',import.meta.url),'utf8');
 await db.exec(boardArchive);
 await db.exec(boardArchive);
 const asUser=async(id,sql)=>{await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);try{return await db.query(sql);}finally{await db.exec('reset role; reset request.jwt.claim.sub;');}};
 await db.exec(`insert into clients(id,name,fee,paper_fee,actual_fee) values('${brand}','Brand',500,500,0); insert into client_assignments values('${manager}','${brand}',now());`);
 assert.equal((await asUser(team,'select id,name from clients')).rows.length,1);
 await assert.rejects(asUser(team,'select fee from clients'),/permission denied/i);
 assert.equal((await asUser(team,'select * from client_finances()')).rows.length,0);
 assert.equal(Number((await asUser(admin,'select * from client_finances()')).rows[0].actual_fee),0);
 await asUser(manager,`delete from clients where id='${brand}'`);
 assert.equal((await db.query('select count(*)::int n from clients')).rows[0].n,1);
 const task={id:taskId,name:'Team task',brief:'Brief',client_id:brand,client_ids:[brand],type:'Personal',due_date:'2026-11-13',priority:'Medium',slot:'any',status:'todo',assigned_user_id:team,assigned_user_ids:[team],refs:'',remind:'none',reminders:[],repeat_type:'none',recurring:false,sort_order:1};
 await db.exec(`insert into client_assignments values('${team}','${brand}',now())`);
 const json=JSON.stringify(task).replaceAll("'","''");
 await asUser(team,`select save_task('${json}'::jsonb)`);
 assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,1);
 const unauthorizedTask={...task,id:'30000000-0000-0000-0000-000000000002',recurring:true,repeat_type:'daily',recurring_template_id:'bad-template'};
 await assert.rejects(asUser(team,`select save_task('${JSON.stringify(unauthorizedTask)}'::jsonb,null,'{"id":"bad-template"}')`),/row-level security|permission denied/i);
 assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,1);
 await assert.rejects(asUser(team,`select save_task('${json}'::jsonb,null,'{"id":"bad-template"}')`),/Task changed/);
 await asUser(team,`update tasks set status='done' where id='${taskId}'`);
 const before=(await db.query(`select completed_at from tasks where id='${taskId}'`)).rows[0].completed_at;
 await asUser(team,`update tasks set completed_at=now()+interval '5 days',priority='High' where id='${taskId}'`);
 assert.equal(String((await db.query(`select completed_at from tasks where id='${taskId}'`)).rows[0].completed_at),String(before));
 await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('10000000-0000-0000-0000-000000000004','new@example.com','{"username":"new"}');`);
 assert.equal((await asUser('10000000-0000-0000-0000-000000000004','select id from tasks')).rows.length,0);
 await assert.rejects(asUser(team,`update profiles set approved=false where id='${team}'`),/Only admins/);
 await asUser(team,`select set_checklist_item('one',true)`);
 await asUser(team,`select set_checklist_item('two',true)`);
 assert.deepEqual((await db.query("select value from workspace_documents where key='monthly_checklist_state'")).rows[0].value,{one:true,two:true});
 const clientJson={id:brand,name:'Changed brand',type:'Personal',billing_model:'retainer',industry:'',category:'',color:'#aabbcc',brief:'',guidelines:'',strat_day:20,drive:'',contact:'',email:'',timeline:[],sort_order:1};
 const clientVersion=(await db.query(`select updated_at from clients where id='${brand}'`)).rows[0].updated_at;
 await asUser(admin,`select save_client('${JSON.stringify(clientJson)}','${new Date(clientVersion).toISOString()}')`);
 const newVersion=(await db.query(`select updated_at from clients where id='${brand}'`)).rows[0].updated_at;
 const invalidClient={...clientJson,name:'Must roll back',timeline:[{id:'milestone',title:'bad date',date:'not-a-date',assignedIds:[]}]};
 await assert.rejects(asUser(admin,`select save_client('${JSON.stringify(invalidClient)}','${new Date(newVersion).toISOString()}')`));
 assert.equal((await db.query(`select name from clients where id='${brand}'`)).rows[0].name,'Changed brand');
 const teamVersion=(await db.query(`select updated_at from profiles where id='${team}'`)).rows[0].updated_at;
 await assert.rejects(asUser(admin,`select save_team_member('${team}','{"expected_version":"${new Date(teamVersion).toISOString()}","full_name":"Must roll back","username":"team","role":"team","color":"#aabbcc","email_reminders":true,"approved":true,"permissions":{"viewGoals":false}}',array['99999999-0000-0000-0000-000000000000']::uuid[])`),/foreign key/i);
 assert.notEqual((await db.query(`select full_name from profiles where id='${team}'`)).rows[0].full_name,'Must roll back');
 const template={id:'monthly-template',name:'Recurring task',anchorDate:'2020-01-01',repeatType:'monthly',clientIds:[brand],assignedIds:[team],type:'Personal'};
 await db.exec(`insert into workspace_documents(key,value) values('recurring_templates','${JSON.stringify([template])}')`);
 assert.equal((await asUser(admin,'select generate_recurring_tasks() n')).rows[0].n,1);
 await db.exec("delete from tasks where recurring_template_id='monthly-template'");
 assert.equal((await asUser(admin,'select generate_recurring_tasks() n')).rows[0].n,0);
 // Schedule a reminder just before now in the agency timezone.
 await db.exec(`update tasks set status='todo',due_date=(now() at time zone 'Asia/Kolkata')::date,
 reminders=jsonb_build_array(jsonb_build_object('daysBefore',0,'time',to_char(now() at time zone 'Asia/Kolkata','HH24:MI'))) where id='${taskId}'`);
 await db.exec('select enqueue_task_reminders()');
 const claimed=(await db.query('select * from claim_task_reminders()')).rows;
 assert.equal(claimed.length,1);
 assert.equal((await db.query('select * from claim_task_reminders()')).rows.length,0);
 await db.query('select finish_task_reminder($1,$2,null)',[claimed[0].id,claimed[0].attempt]);
 assert.equal((await db.query('select * from claim_task_reminders()')).rows.length,0);
 await assert.rejects(asUser(team,'select * from claim_task_reminders()'),/permission denied/i);
 const recurringVersion=(await db.query("select updated_at from workspace_documents where key='recurring_templates'")).rows[0].updated_at;
 await asUser(admin,`select delete_recurring_template('monthly-template','${new Date(recurringVersion).toISOString()}')`);
 assert.deepEqual((await db.query("select value from workspace_documents where key='recurring_templates'")).rows[0].value,[]);
 await assert.rejects(asUser(admin,`update profiles set approved=false where id='${admin}'`),/at least one approved administrator/);
 await assert.rejects(asUser(team,'select reset_workspace()'),/Only admins/);
 // The existing hourly cleanup target must retain completed work and archive once.
 await asUser(team,`update tasks set status='done' where id='${taskId}'`);
 await db.exec(`alter table tasks disable trigger tasks_set_completed_at;
 update tasks set completed_at=now()-interval '25 hours' where id='${taskId}';
 alter table tasks enable trigger tasks_set_completed_at;`);
 await assert.rejects(asUser(team,'select purge_expired_completed_tasks()'),/permission denied/i);
 assert.equal((await db.query('select purge_expired_completed_tasks() n')).rows[0].n,1);
 assert.equal((await db.query('select purge_expired_completed_tasks() n')).rows[0].n,0);
 let retained=(await asUser(team,`select * from tasks where id='${taskId}'`)).rows[0];
 assert.ok(retained.archived_at);assert.equal(retained.brief,'Brief');assert.equal(retained.priority,'High');
 // Reopening an archived task restores it without erasing any content.
 await asUser(team,`update tasks set status='progress' where id='${taskId}'`);
 retained=(await db.query(`select * from tasks where id='${taskId}'`)).rows[0];
 assert.equal(retained.archived_at,null);assert.equal(retained.completed_at,null);
 assert.equal((await db.query('select purge_expired_completed_tasks() n')).rows[0].n,0);
 await asUser(team,`update tasks set status='done' where id='${taskId}'`);
 assert.equal((await db.query('select purge_expired_completed_tasks() n')).rows[0].n,0);
 const newUser='10000000-0000-0000-0000-000000000004';
 assert.equal((await asUser(newUser,`update tasks set status='todo' where id='${taskId}' returning id`)).rows.length,0);
 } finally { await db.close(); }
});
