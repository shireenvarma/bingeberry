import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaskDetails } from '../task-details.js';

const context = () => ({ task: {id:'task',name:'Campaign launch',brief:'Goal\n'+ 'A long brief. '.repeat(500),status:'todo',priority:'Medium',due:'2026-11-20',refs:'https://example.com/reference,javascript:alert(1)',updatedAt:'original-version'},brands:'Brand',owners:'Team member',updated:'Today',canEdit:true,canManage:true });
function setup(options={}) {
 const dom=new JSDOM('<button data-open-task="task">Campaign launch</button>',{url:'https://example.com'});
 const panel=createTaskDetails({document:dom.window.document,onSave:async()=>null,onAdvanced:()=>{},confirmDiscard:()=>true,...options});
 const source=dom.window.document.querySelector('button');source.focus();panel.open(context(),source);
 const dialog=dom.window.document.getElementById('task-details');
 return {dom,panel,dialog,source};
}
const input=(dom,el,value)=>{el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
const submit=async(dom,dialog)=>{dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));};

test('panel shows full brief and safe references; closing restores focus',()=>{
 const {dom,panel,dialog,source}=setup();
 assert.equal(dialog.querySelector('#detail-brief').value,context().task.brief);
 assert.equal(dialog.querySelectorAll('a').length,1);
 assert.equal(dialog.querySelector('a').getAttribute('rel'),'noopener noreferrer');
 assert.ok(dialog.open);panel.close();assert.equal(dialog.open,false);assert.equal(dom.window.document.activeElement,source);
 dom.window.close();
});

test('saving sends only changed fields with the original task snapshot',async()=>{
 let received;
 const {dom,dialog}=setup({onSave:async(task,patch)=>{received={task,patch};return {...context(),task:{...task,...patch,updatedAt:'new-version'}};}});
 input(dom,dialog.querySelector('#detail-brief'),'Updated brief');
 await submit(dom,dialog);
 assert.deepEqual(received.patch,{brief:'Updated brief'});
 assert.equal(received.task.updatedAt,'original-version');
 assert.equal(dialog.querySelector('[type="submit"]').disabled,true);
 assert.equal(dialog.querySelector('#detail-brief').value,'Updated brief');
 dom.window.close();
});

test('failed save and background refresh preserve unsaved text',async()=>{
 const {dom,dialog,panel}=setup({onSave:async()=>({error:'Task changed. Reopen to load the latest version.'}),confirmDiscard:()=>false});
 input(dom,dialog.querySelector('#detail-brief'),'Keep my draft');
 panel.reconcile({...context(),task:{...context().task,brief:'Someone else edited this',updatedAt:'new-version'}});
 assert.equal(dialog.querySelector('#detail-brief').value,'Keep my draft');
 await submit(dom,dialog);
 assert.equal(dialog.querySelector('#detail-brief').value,'Keep my draft');
 assert.match(dialog.querySelector('[role="status"]').textContent,/Task changed/);
 assert.equal(panel.close(),false);assert.ok(dialog.open);
 dom.window.close();
});

test('readonly viewers cannot edit; assignees can change status without editing briefs',async()=>{
 const {dom,panel,dialog}=setup();panel.open({...context(),canEdit:false,canManage:false});
 assert.ok(dialog.querySelector('#detail-name').readOnly);assert.ok(dialog.querySelector('#detail-brief').readOnly);
 assert.ok(dialog.querySelector('#detail-status').disabled);assert.equal(dialog.querySelector('[type="submit"]'),null);
 panel.open({...context(),canEdit:false,canManage:true});
 assert.ok(dialog.querySelector('#detail-brief').readOnly);assert.equal(dialog.querySelector('#detail-status').disabled,false);
 dom.window.close();
});

test('clean panel reflects background updates; removed tasks close only when clean',()=>{
 const {dom,dialog,panel}=setup();
 panel.reconcile({...context(),task:{...context().task,brief:'Latest brief'}});
 assert.equal(dialog.querySelector('#detail-brief').value,'Latest brief');
 panel.reconcile(null);assert.equal(dialog.open,false);
 panel.open(context());input(dom,dialog.querySelector('#detail-brief'),'Draft on deleted task');panel.reconcile(null);
 assert.ok(dialog.open);assert.match(dialog.querySelector('[role="status"]').textContent,/removed/);
 dom.window.close();
});

test('untrusted task content is rendered as text',()=>{
 const {dom,dialog,panel}=setup();const payload='</textarea><img src=x onerror=alert(1)>';
 panel.open({...context(),task:{...context().task,name:payload,brief:payload},brands:payload});
 assert.equal(dialog.querySelectorAll('img').length,0);
 assert.equal(dialog.querySelector('#detail-name').value,payload);assert.equal(dialog.querySelector('#detail-brief').value,payload);
 dom.window.close();
});
