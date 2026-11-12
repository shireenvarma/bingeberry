import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as utils from '../app-utils.js';
import { taskBriefContent, escapeTaskText } from '../task-content.js';
import { renderTaskFilters } from '../task-filters.js';
import { attachTaskDragAndDrop } from '../task-dnd.js';
import { createTaskDetails } from '../task-details.js';
import { renderTaskBoard, BOARD_STATUSES } from '../task-board.js';
import { resolveRequestPath } from '../scripts/serve-local.mjs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/bootstrap\(\);\s*$/,'');
function app(authClient = null) {
 const dom=new JSDOM(html,{url:'https://example.com/bingeberry/'});
 const context={...utils,window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
  BINGEBERRY_CONFIG:authClient ? {supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'test'} : {},createClient:()=>authClient,
  taskBriefContent,escapeTaskText,renderTaskFilters,attachTaskDragAndDrop,createTaskDetails,renderTaskBoard,BOARD_STATUSES,
  crypto:globalThis.crypto,URL:globalThis.URL,URLSearchParams,Blob,console:{...console,error:()=>{}},structuredClone,
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},confirm:()=>true};
 vm.createContext(context);vm.runInContext(source,context);
 vm.runInContext(`CURRENT_USER={id:'user',name:'Admin',role:'admin',clients:['brand'],approved:true};
 DB.users=[CURRENT_USER]; DB.clients=[{id:'brand',name:'Brand',type:'Personal',color:'#abcdef',paperFee:0,actualFee:0,timeline:[]}];`,context);
 return {dom,context,run:code=>vm.runInContext(code,context)};
}

test('untrusted names, briefs, colors and reference URLs render as inert text',()=>{
 const {dom,run,context}=app();
 const payload='<img src=x onerror="alert(1)">';
 context.payload=payload;
 run(`DB.users[0].name=payload; DB.users[0].color='red;" onmouseover="alert(1)';
 DB.clients[0].name=payload; DB.clients[0].guidelines=payload;
 DB.tasks=[{id:'task',name:payload,brief:payload.repeat(500),clientIds:['brand'],assignedIds:['user'],type:payload,priority:'Medium',status:'todo',due:todayStr,sortOrder:1,refs:'javascript:alert(1)'}];
 renderTeam(); renderTasksPage(); renderWeek(); renderGuidelines();`);
 for(const id of ['users-grid','main-task-body','week-grid','guidelines-grid']) {
  const el=dom.window.document.getElementById(id);
  assert.equal(el.querySelectorAll('img').length,0,id);
  assert.ok(el.textContent.includes(payload),id);
 }
 assert.equal(dom.window.document.querySelector('#main-task-body a').getAttribute('href'),'#');
 assert.equal(dom.window.document.querySelector('.task-brief'),null);
 context.openTaskDetails('task');
 assert.equal(dom.window.document.getElementById('detail-brief').value,payload.repeat(500));
 assert.equal(dom.window.document.querySelector('#task-details img'),null);
 dom.window.close();
});

test('filters combine and clear without adding controls as the team grows',()=>{
 const {dom,run}=app();
 run(`DB.users=Array.from({length:100},(_,i)=>({id:String(i),name:'Person '+i,approved:true}));
 DB.tasks=[{id:'a',name:'Task',clientIds:['brand'],assignedIds:['5'],type:'Personal',status:'todo',priority:'Medium',due:todayStr,sortOrder:1}];
 setFilter('client','brand'); setFilter('type','Personal'); setFilter('assigned','5');`);
 const bar=dom.window.document.getElementById('filter-bar');
 assert.equal(bar.querySelectorAll('select').length,4);
 assert.equal(bar.querySelector('[name="assigned"]').options.length,101);
 assert.equal(bar.querySelector('[name="client"]').value,'brand');
 assert.equal(bar.querySelector('.task-filter-count').textContent,'1 task');
 bar.querySelector('button').click();
 assert.equal(bar.querySelector('[name="client"]').value,'All');
 dom.window.close();
});

test('dates use local calendar days, monthly dates clip correctly, zero revenue stays zero',()=>{
 assert.equal(utils.localDate(new Date(2026,10,13)),'2026-11-13');
 const {dom,run}=app();
 assert.equal(run('monthDate(13,new Date(2026,10,1))'),'2026-11-13');
 assert.equal(run("getDueDateForTemplate({anchorDate:'2026-01-31',repeatType:'monthly'},new Date(2026,1,15))"),'2026-02-28');
 run('DB.clients[0].fee=500; syncRevenueGoal();');
 assert.equal(run('DB.goals[0].metrics[1].current'),0);
 dom.window.close();
});

test('background refresh preserves quick-add and settings drafts, scroll and the task panel',async()=>{
 const {dom,run,context}=app();
 run(`DB.tasks=[{id:'a',name:'Task',brief:'Full brief',clientIds:['brand'],assignedIds:['user'],type:'Personal',status:'todo',priority:'Medium',due:todayStr,sortOrder:1}]; showPage('tasks');
 loadWorkspace=async()=>{}; showToast=()=>{throw Error('Unexpected background toast')};`);
 const doc=dom.window.document;doc.getElementById('qa-name').value='Unsaved draft';doc.getElementById('qa-refs').value='https://example.com/draft';context.openTaskDetails('a');doc.getElementById('main-content').scrollTop=300;
 await context.refreshWorkspaceFromUI({silent:true});
 assert.equal(doc.getElementById('qa-name').value,'Unsaved draft');assert.equal(doc.getElementById('qa-refs').value,'https://example.com/draft');assert.ok(doc.getElementById('task-details').open);assert.equal(doc.getElementById('detail-brief').value,'Full brief');assert.equal(doc.getElementById('main-content').scrollTop,300);
 doc.querySelector('#task-details [data-detail-close]').click();
 run("showPage('settings')");doc.getElementById('new-password').value='Unsaved password';await context.refreshWorkspaceFromUI({silent:true});assert.equal(doc.getElementById('new-password').value,'Unsaved password');
 dom.window.close();
});

test('mobile menu is keyboard-operable and closes on navigation; tables align',()=>{
 const {dom,run,context}=app();const doc=dom.window.document;const button=doc.querySelector('.mobile-menu');
 context.toggleMobileMenu(button);assert.equal(button.getAttribute('aria-expanded'),'true');
 run("showPage('tasks')");assert.equal(button.getAttribute('aria-expanded'),'false');
 for(const id of ['dash-all','dash-week','dash-overdue'])assert.equal(doc.getElementById(id).closest('table').querySelectorAll('thead th').length,9);
 dom.window.close();
});

test('timer restores elapsed and paused states and validates URL schemes',()=>{
 assert.equal(utils.restoreTimer({mode:'focus',remainingMs:60000,running:true,endsAt:90000},60000).remainingMs,30000);
 assert.equal(utils.restoreTimer({mode:'focus',remainingMs:60000,running:false},60000).remainingMs,60000);
 assert.equal(utils.restoreTimer({mode:'focus',remainingMs:60000,running:true,endsAt:90000},100000).remainingMs,0);
 assert.equal(utils.safeUrl('javascript:alert(1)'),'#');
 assert.equal(utils.safeUrl('https://evil.example/calendar/embed',true),'#');
 assert.equal(utils.safeUrl('https://calendar.google.com/calendar/embed?src=team',true),'https://calendar.google.com/calendar/embed?src=team');
});

test('paginated reads fetch every page and surface errors',async()=>{
 const rows=Array.from({length:1201},(_,id)=>({id}));
 const result=await utils.fetchAll(()=>({range:async(from,to)=>({data:rows.slice(from,to+1),error:null})}));
 assert.equal(result.data.length,1201);
 await assert.rejects(utils.fetchAll(()=>({range:async()=>({data:null,error:Error('Offline')})})),/Offline/);
});

test('local server rejects malformed, hidden and escaping request paths',()=>{
 assert.throws(()=>resolveRequestPath('/%ZZ'),URIError);
 assert.equal(resolveRequestPath('/../bingeberry-secrets/file'),null);
 assert.equal(resolveRequestPath('/.git/config'),null);
 assert.equal(resolveRequestPath('/%2e%2e/other'),null);
 assert.ok(resolveRequestPath('/app.js').endsWith('/app.js'));
});

test('quick add blocks double submits and reports a committed save accurately if refresh fails',async()=>{
 const {dom,run,context}=app();
 run("renderTasksPage(); ensureSession=async()=>{};");
 dom.window.document.getElementById('qa-name').value='Only one task';
 dom.window.document.getElementById('qa-refs').value='https://example.com/concept, https://example.com/copy';
 let resolveSave;let requests=0;let message;let saved;
 context.waitForSave=new Promise(resolve=>{resolveSave=resolve;});
 context.recordRequest=(name,args)=>{requests++;saved={name,args};};
 context.recordMessage=m=>{message=m;};
 run("rpc=async(name,args)=>{recordRequest(name,args);await waitForSave;}; loadWorkspace=async()=>{throw Error('Offline')}; showToast=recordMessage;");
 const first=context.saveQuickTask();await context.saveQuickTask();assert.equal(requests,1);
 resolveSave();await first;
 assert.match(message,/Task saved/);assert.equal(dom.window.document.getElementById('qa-name').value,'');
 assert.equal(saved.name,'save_task');assert.equal(saved.args.p_task.refs,'https://example.com/concept, https://example.com/copy');
 assert.equal(dom.window.document.getElementById('qa-refs').value,'');
 dom.window.close();
});

test('full task form places one labeled reference field immediately after the brief',()=>{
 const {dom}=app();const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('#t-refs').length,1);
 assert.equal(doc.getElementById('t-brief').closest('.form-group').nextElementSibling.querySelector('input').id,'t-refs');
 assert.equal(doc.getElementById('t-refs').labels[0].textContent,'Reference Links (Optional)');
 dom.window.close();
});

test('temporary initialization failure retains the auth session and exposes retry',async()=>{
 const {dom,run,context}=app();
 run("ensureProfile=async()=>{throw Error('Temporary network error')};");
 const previous=console.error;console.error=()=>{};
 try {await context.hydrateFromSession({id:'user'});}finally{console.error=previous;}
 assert.equal(dom.window.document.getElementById('auth-retry-btn').hidden,false);
 assert.match(dom.window.document.getElementById('auth-err').textContent,/Temporary network error/);
 assert.ok(!run('CURRENT_USER'));
 dom.window.close();
});

test('same-user auth events preserve navigation and recovery events preserve typed passwords',async()=>{
 let handler;const auth={getSession:async()=>({data:{session:{user:{id:'user'}}}}),onAuthStateChange:fn=>{handler=fn;}};
 const {dom,run,context}=app({auth});let initialized=0;
 context.recordInit=()=>initialized++;
 run("hydrateFromSession=async()=>recordInit(); showPage('tasks');");
 await context.bootstrap();assert.equal(initialized,1);
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'])handler(event,{user:{id:'user'}});
 assert.equal(initialized,1);assert.equal(run('currentPage'),'tasks');
 handler('PASSWORD_RECOVERY',{user:{id:'user',email:'team@example.com'}});
 assert.equal(run('authMode'),'recovery');
 dom.window.document.getElementById('auth-pass').value='A new password';
 handler('TOKEN_REFRESHED',{user:{id:'user'}});
 assert.equal(dom.window.document.getElementById('auth-pass').value,'A new password');
 dom.window.close();
});

test('task title opens a detail panel without changing list filters or scroll',()=>{
 const {dom,run,context}=app();
 run(`DB.tasks=[{id:'a',name:'Open this task',brief:'Read the full brief',clientIds:['brand'],assignedIds:['user'],type:'Personal',status:'todo',priority:'Medium',due:todayStr,sortOrder:1}];
 bindBaseEvents(); showPage('tasks'); setFilter('client','brand');`);
 const doc=dom.window.document;doc.getElementById('main-content').scrollTop=200;
 doc.querySelector('[data-open-task="a"]').click();
 assert.ok(doc.getElementById('task-details').open);
 assert.equal(doc.getElementById('detail-brief').value,'Read the full brief');
 assert.equal(run('currentPage'),'tasks');assert.equal(run('activeFilters.client'),'brand');
 assert.equal(doc.getElementById('main-content').scrollTop,200);
 doc.querySelector('#task-details [data-detail-close]').click();
 assert.equal(doc.getElementById('task-details').open,false);
 dom.window.close();
});

test('Table and Board share filters and details while preserving drafts, view and navigation',async()=>{
 const {dom,run,context}=app();const doc=dom.window.document;
 run(`DB.tasks=[{id:'a',name:'Campaign',brief:'Full campaign brief',clientIds:['brand'],assignedIds:['user'],type:'Personal',status:'progress',priority:'High',due:todayStr,sortOrder:1},
 {id:'b',name:'Other work',clientIds:[],assignedIds:[],type:'Personal',status:'todo',priority:'Low',due:todayStr,sortOrder:2}];
 bindBaseEvents();showPage('tasks');`);
 doc.getElementById('qa-name').value='Unsaved task';
 context.setTaskLayout('board');context.setFilter('client','brand');
 assert.equal(doc.getElementById('task-table-view').hidden,true);
 assert.equal(doc.getElementById('task-board').hidden,false);
 assert.equal(doc.querySelectorAll('#task-board .board-card').length,1);
 doc.querySelector('#task-board [data-open-task="a"]').click();
 assert.equal(doc.getElementById('detail-brief').value,'Full campaign brief');
 doc.querySelector('#task-details [data-detail-close]').click();
 run('loadWorkspace=async()=>{}');await context.refreshWorkspaceFromUI({silent:true});
 assert.equal(context.getTaskLayout(),'board');assert.equal(run('activeFilters.client'),'brand');assert.equal(run('currentPage'),'tasks');
 context.setTaskLayout('table');assert.equal(doc.getElementById('qa-name').value,'Unsaved task');
 context.setTaskHistory('archived');context.setTaskHistory('active');assert.equal(doc.getElementById('qa-name').value,'Unsaved task');
 assert.equal(doc.getElementById('task-view-table').getAttribute('aria-pressed'),'true');
 assert.equal(doc.getElementById('task-board').hidden,true);
 dom.window.close();
});

test('team members cannot use Quick Add but can open normal Add Task',async()=>{
 const {dom,run,context}=app();
 run(`CURRENT_USER.role='team';renderTasksPage();rpc=()=>{throw Error('Unexpected quick-add request')};`);
 assert.equal(dom.window.document.getElementById('qa-name'),null);
 assert.equal(context.canCreateTask(),true);
 await context.saveQuickTask();
 context.openTaskModal();
 assert.ok(dom.window.document.getElementById('task-modal').classList.contains('open'));
 run("CURRENT_USER.role='manager';renderTasksPage()");
 assert.ok(dom.window.document.getElementById('qa-name'));
 dom.window.close();
});

test('archived work is excluded from current views but can be filtered and opened in history',()=>{
 const {dom,run,context}=app();
 run(`DB.tasks=[{id:'a',name:'Retained work',brief:'Old brief',refs:'https://pin.it/concept',clientIds:['brand'],assignedIds:['user'],type:'Personal',status:'done',priority:'Medium',due:todayStr,sortOrder:1,archivedAt:'2026-11-12T10:00:00Z'}];showPage('tasks');`);
 assert.equal(context.visibleTasks().length,0);assert.equal(context.getTasksPageTasks().length,0);
 context.setTaskHistory('archived');
 assert.equal(context.getTasksPageTasks().length,1);assert.equal(dom.window.document.getElementById('qa-name'),null);
 context.setFilter('assigned','user');context.setTaskLayout('board');
 assert.equal(dom.window.document.querySelectorAll('#task-board .board-card').length,1);
 context.openTaskDetails('a');
 assert.equal(dom.window.document.getElementById('detail-brief').value,'Old brief');
 assert.equal(dom.window.document.querySelector('#task-details a').href,'https://pin.it/concept');
 dom.window.close();
});

test('Board status moves persist only status, detect conflicts and block unauthorized changes',async()=>{
 const calls=[];let conflict=false;let fail=false;let finish;
 const row={id:'a',name:'Campaign',client_ids:['brand'],assigned_user_ids:['user'],type:'Personal',status:'todo',priority:'High',due_date:'2026-11-13',sort_order:1,updated_at:'2026-11-13T10:00:00Z'};
 const authClient={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},from:table=>{
  const call={table,filters:[]};calls.push(call);
  const query={update:patch=>{call.patch=patch;return query;},eq:(...args)=>{call.filters.push(args);return query;},select:async()=>{
   await new Promise(resolve=>{finish=resolve;});
   return {data:conflict?[]:[{...row,...call.patch,updated_at:'2026-11-13T10:01:00Z'}],error:fail?Error('Offline'):null};
  }};return query;
 }};
 const {dom,run,context}=app(authClient);context.row=row;
 run("DB.tasks=[mapTaskFromRow(row)];showPage('tasks');setTaskLayout('board');loadWorkspace=()=>{throw Error('Unexpected workspace reload')}");
 const first=context.moveBoardTask('a','review');await new Promise(resolve=>setImmediate(resolve));
 await context.moveBoardTask('a','done');assert.equal(calls.length,1);
 assert.equal(dom.window.document.querySelector('#task-board .board-move').disabled,true);
 finish();await first;
 assert.deepEqual({...calls[0].patch},{status:'review',updated_by:'user'});
 assert.deepEqual(calls[0].filters,[['id','a'],['updated_at',row.updated_at]]);
 assert.equal(run('DB.tasks[0].status'),'review');assert.equal(run('DB.tasks[0].priority'),'High');
 assert.equal(dom.window.document.querySelector('#task-board .board-move').disabled,false);
 conflict=true;const stale=context.moveBoardTask('a','done');await new Promise(resolve=>setImmediate(resolve));finish();await stale;
 assert.equal(run('DB.tasks[0].status'),'review');assert.match(dom.window.document.getElementById('task-board-message').textContent,/not moved/);
 conflict=false;fail=true;const offline=context.moveBoardTask('a','done');await new Promise(resolve=>setImmediate(resolve));finish();await offline;
 assert.equal(run('DB.tasks[0].status'),'review');assert.equal(dom.window.document.querySelector('#task-board .board-move').disabled,false);
 run("CURRENT_USER.role='team';DB.tasks[0].assignedIds=['other'];renderTasksPage()");
 await context.moveBoardTask('a','done');await context.moveBoardTask('a','invalid');assert.equal(calls.length,3);
 assert.equal(dom.window.document.querySelector('#task-board .board-move'),null);
 dom.window.close();
});

test('view switching works without localStorage and preferences stay account-specific',()=>{
 const {dom,run,context}=app();
 run("localStorage={setItem:()=>{throw Error('Storage unavailable')},getItem:()=>{throw Error('Storage unavailable')}};renderTasksPage();setTaskLayout('board')");
 assert.equal(context.getTaskLayout(),'board');
 run("CURRENT_USER={...CURRENT_USER,id:'other'}");assert.equal(context.getTaskLayout(),'table');
 dom.window.close();
});
