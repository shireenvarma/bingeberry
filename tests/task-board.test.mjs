import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTaskBoard, BOARD_STATUSES } from '../task-board.js';

const task = (id, status='todo') => ({ id, status, name:'Campaign '+id, priority:'High' });
function setup(overrides={}) {
  const dom = new JSDOM('<div id="board"></div>');
  const board = dom.window.document.getElementById('board');
  const moves = [];
  const config = { tasks:[task('a'),task('b','blocked')], canMove:()=>true, isPending:()=>false,
    brands:()=> 'Brand', owners:()=> 'Owner', dueLabel:()=> '20 Nov', isOverdue:()=>false,
    onMove:async(...args)=>moves.push(args), ...overrides };
  renderTaskBoard(board,config);
  return {dom,board,config,moves};
}
const dispatch = (dom,el,type,props={}) => {
  const event=new dom.window.Event(type,{bubbles:true,cancelable:true});
  Object.assign(event,props);el.dispatchEvent(event);return event;
};
const flush = () => new Promise(resolve=>setImmediate(resolve));

test('board renders every workflow column, counts, empty states and safe card content',()=>{
  const payload='</button><img src=x onerror=alert(1)>';
  const {dom,board}=setup({tasks:[{...task('a'),name:payload}],brands:()=>payload,owners:()=>payload});
  assert.equal(board.querySelectorAll('.board-column').length,BOARD_STATUSES.length);
  assert.equal(board.querySelectorAll('.board-empty').length,4);
  assert.equal(board.querySelector('[data-board-status="todo"] .board-count').textContent,'1');
  assert.equal(board.querySelector('img'),null);
  assert.equal(board.querySelector('[data-open-task]').textContent,payload);
  dom.window.close();
});

test('dragging between columns changes status once; unrelated external drops are ignored',async()=>{
  const {dom,board,moves,config}=setup();
  renderTaskBoard(board,config); // Repeated renders must not duplicate handlers.
  const target=board.querySelector('[data-board-status="review"]');
  dispatch(dom,target,'drop');await flush();assert.equal(moves.length,0);
  const handle=board.querySelector('[data-task-id="a"] .board-drag-handle');
  const dataTransfer={setData:()=>{}};
  dispatch(dom,handle,'dragstart',{dataTransfer});
  assert.equal(dataTransfer.effectAllowed,'move');
  assert.ok(dispatch(dom,target,'dragover',{dataTransfer}).defaultPrevented);
  assert.ok(target.classList.contains('board-drop-target'));
  dispatch(dom,target,'drop');await flush();
  assert.deepEqual(moves,[['a','review']]);
  assert.equal(board.querySelector('.board-drop-target'),null);
  dispatch(dom,target,'drop');await flush();assert.equal(moves.length,1);
  dom.window.close();
});

test('Move to supports keyboard/touch, rejects same-status changes and restores failed selection',async()=>{
  const {dom,board,moves}=setup();
  const select=board.querySelector('[data-task-id="a"] select');
  dispatch(dom,select,'change');await flush();assert.equal(moves.length,0);
  select.value='done';dispatch(dom,select,'change');await flush();
  assert.deepEqual(moves,[['a','done']]);
  assert.equal(select.value,'todo');assert.equal(select.disabled,false);
  dom.window.close();
});

test('read-only and pending cards cannot be dragged or moved',async()=>{
  const {dom,board,moves}=setup({canMove:t=>t.id==='a',isPending:t=>t.id==='a'});
  assert.equal(board.querySelector('[data-task-id="b"] select'),null);
  assert.equal(board.querySelector('[data-task-id="b"] .board-drag-handle'),null);
  const handle=board.querySelector('[data-task-id="a"] .board-drag-handle');
  assert.equal(handle.draggable,false);
  assert.ok(dispatch(dom,handle,'dragstart').defaultPrevented);
  dispatch(dom,board.querySelector('[data-board-status="done"]'),'drop');await flush();
  assert.equal(moves.length,0);
  dom.window.close();
});

test('refresh cancels stale drags and preserves horizontal scroll',async()=>{
  const {dom,board,moves,config}=setup();
  dispatch(dom,board.querySelector('.board-drag-handle'),'dragstart');board.scrollLeft=280;
  renderTaskBoard(board,config);
  assert.equal(board.scrollLeft,280);
  dispatch(dom,board.querySelector('[data-board-status="done"]'),'drop');await flush();
  assert.equal(moves.length,0);
  dom.window.close();
});
