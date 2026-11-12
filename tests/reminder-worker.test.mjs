import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../supabase/functions/task-reminders/index.ts',import.meta.url),'utf8');
function worker(overrides={},providerStatus=200) {
 const env={REMINDER_CRON_SECRET:'scheduler-secret',RESEND_API_KEY:'provider-secret',REMINDER_FROM:'tasks@example.com',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-secret',...overrides};
 const calls=[];let handler;
 vm.runInNewContext(source,{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},Request,Response,AbortSignal,fetch:async(url,options)=>{
   calls.push({url,...options});
   if(url.endsWith('claim_task_reminders'))return Response.json([{id:'job',email:'team@example.com',task_name:'Campaign',due_date:'2026-11-13',attempt:1}]);
   if(url.includes('api.resend.com'))return new Response('{}',{status:providerStatus});
   return new Response(null,{status:204});
 }});
 return {handler,calls};
}
test('reminder worker rejects unauthenticated invocations and missing provider settings',async()=>{
 const {handler,calls}=worker();assert.equal((await handler(new Request('https://example.com'))).status,401);assert.equal(calls.length,0);
 const missing=worker({RESEND_API_KEY:null});assert.equal((await missing.handler(new Request('https://example.com',{headers:{authorization:'Bearer scheduler-secret'}}))).status,503);
});
test('reminder worker uses provider idempotency and records delivery acknowledgement',async()=>{
 const {handler,calls}=worker();
 assert.equal((await handler(new Request('https://example.com',{headers:{authorization:'Bearer scheduler-secret'}}))).status,200);
 assert.equal(calls[1].headers['idempotency-key'],'task-reminder-job');
 assert.equal(JSON.parse(calls[2].body).p_error,null);
 assert.equal(JSON.parse(calls[2].body).p_attempt,1);
});
test('provider failure is recorded for bounded retries without reporting success',async()=>{
 const {handler,calls}=worker({},429);
 const response=await handler(new Request('https://example.com',{headers:{authorization:'Bearer scheduler-secret'}}));
 assert.equal((await response.json()).sent,0);
 assert.match(JSON.parse(calls[2].body).p_error,/429/);
});
