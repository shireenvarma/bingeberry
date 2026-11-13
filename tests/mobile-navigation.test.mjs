import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMobileNavigation } from '../mobile-navigation.js';

function setup(mobile=true) {
  const dom=new JSDOM(`<div class="app-topbar"><button class="mobile-menu" aria-expanded="false">Menu</button></div>
    <aside id="sidebar"><button data-mobile-nav-close>Close</button><button class="nav-item active">Tasks</button><button>Settings</button></aside>
    <button id="mobile-nav-backdrop" hidden></button><main id="main-content"><input></main>`);
  let onChange;
  const media={matches:mobile,addEventListener:(_,listener)=>{onChange=listener;}};
  dom.window.matchMedia=()=>media;
  const nav=createMobileNavigation(dom.window.document);
  return {dom,nav,doc:dom.window.document,resize:matches=>{media.matches=matches;onChange();}};
}

test('mobile navigation isolates the drawer, restores focus and dismisses on backdrop or Escape',()=>{
  const {dom,doc,nav}=setup();
  const trigger=doc.querySelector('.mobile-menu');trigger.focus();nav.toggle();
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(doc.getElementById('sidebar').getAttribute('aria-modal'),'true');
  assert.ok(doc.getElementById('main-content').hasAttribute('inert'));
  assert.ok(doc.querySelector('.app-topbar').hasAttribute('inert'));
  assert.equal(doc.activeElement,doc.querySelector('[data-mobile-nav-close]'));
  doc.getElementById('mobile-nav-backdrop').click();
  assert.equal(doc.activeElement,trigger);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  assert.equal(doc.getElementById('main-content').hasAttribute('inert'),false);
  nav.toggle();doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.ok(doc.getElementById('mobile-nav-backdrop').hidden);
  assert.equal(doc.getElementById('sidebar').getAttribute('aria-hidden'),'true');
  dom.window.close();
});

test('Tab wraps within the open drawer and the close button works',()=>{
  const {dom,doc,nav}=setup();nav.toggle();
  const buttons=doc.querySelectorAll('#sidebar button');buttons[0].focus();
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(doc.activeElement,buttons[2]);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(doc.activeElement,buttons[0]);buttons[0].click();
  assert.equal(doc.querySelector('.mobile-menu').getAttribute('aria-expanded'),'false');
  dom.window.close();
});

test('desktop resize removes mobile state without unlocking preexisting inert content',()=>{
  const {dom,doc,nav,resize}=setup();doc.getElementById('main-content').setAttribute('inert','');nav.toggle();resize(false);
  assert.equal(doc.getElementById('sidebar').hasAttribute('aria-hidden'),false);
  assert.equal(doc.getElementById('sidebar').hasAttribute('role'),false);
  assert.ok(doc.getElementById('mobile-nav-backdrop').hidden);
  assert.ok(doc.getElementById('main-content').hasAttribute('inert'));
  assert.equal(doc.querySelector('.app-topbar').hasAttribute('inert'),false);
  nav.toggle();assert.equal(doc.getElementById('sidebar').classList.contains('mobile-open'),false);
  dom.window.close();
});
