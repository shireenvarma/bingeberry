import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveRequestPath } from '../../scripts/serve-local.mjs';

// A loopback-only test server seeds the real UI and substitutes Auth/data writes.
// The production application has no fixture mode and tests never contact Supabase.
const root = fileURLToPath(new URL('../../', import.meta.url));
const fakeClient = `const createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'qa-user'}}}})},from:()=>{
 let patch={},id;const query={update:value=>{patch=value;return query;},eq:(key,value)=>{if(key==='id')id=value;return query;},select:async()=>({data:[{...mapTaskToRow(DB.tasks.find(task=>task.id===id)),...patch,updated_at:new Date().toISOString()}],error:null})};return query;
}});`;
const seed = `
CURRENT_USER={id:'qa-user',name:'QA Administrator',username:'qa',email:'qa@example.com',role:'admin',clients:['brand'],approved:true,color:'#c8f065'};
DB.users=[CURRENT_USER,{id:'teammate',name:'A teammate with a longer display name',email:'teammate@example.com',role:'team',clients:['brand'],approved:true,color:'#6eb5ff'}];
DB.clients=[{id:'brand',name:'Caffena Seasonal Campaign',type:'Branding',color:'#ffb547',sortOrder:1,paperFee:0,actualFee:0,timeline:[],guidelines:'Brand guidelines and campaign context. '.repeat(20),contact:'Client contact',email:'marketing@example.com',drive:'https://example.com/references'}];
DB.tasks=['todo','progress','review','blocked','done'].map((status,i)=>({id:'task-'+i,name:i?'Launch campaign asset '+i:'Build a complete content calendar for the upcoming seasonal campaign',brief:'Campaign objective and deliverables. '.repeat(150),clientIds:['brand'],assignedIds:['qa-user','teammate'],type:'Branding',status,priority:'High',due:todayStr,sortOrder:i+1,updatedAt:'2026-11-13T00:00:00Z',refs:'https://pin.it/concept,https://pinterest.com/pin/reference'}));
DB.recurring=[{...DB.tasks[0],repeatType:'monthly',anchorDate:todayStr}];
bindBaseEvents();showApp();initApp();showPage('tasks');
window.__mobileQA={setPage:showPage,setRole:role=>{CURRENT_USER.role=role;renderTasksPage();},setTimer:()=>{focusTimerState={...focusTimerState,running:true,remainingMs:72*3600000,endsAt:Date.now()+72*3600000};setFocusRunningView('floating');showPage('tasks');},stopTimer:()=>{focusTimerState.running=false;renderAll();},showAuth:mode=>{showAuthScreen();setAuthMode(mode);},confirmEmail:()=>openSignupConfirmation('a-teammate-with-a-long-email-address@example.com')};
`;
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
const server = http.createServer(async (req,res) => {
  try {
    const url=new URL(req.url,'http://localhost');
    const file=resolveRequestPath(url.pathname,root);
    if (!file || !types[path.extname(file)]) { res.writeHead(404);res.end();return; }
    let body=await readFile(file);
    if (file === path.join(root,'index.html') && url.searchParams.has('baseline')) body=Buffer.from(body.toString().replace(/<link[^>]*href="\.\/mobile\.css"[^>]*>/,''));
    if (file === path.join(root,'app.js')) body=Buffer.from(body.toString().replace(/^import \{ createClient \} from .*;$/m,fakeClient).replace(/bootstrap\(\);\s*$/,seed));
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(body);
  } catch {res.writeHead(404);res.end();}
});
let browser;
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',isMobile:true,hasTouch:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  let page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const visit=async(url=base)=>{
    await page.goto(url);await page.locator('#app.active').waitFor();
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  };
  const noOverflow=async(label)=>{
    const result=await page.evaluate(()=>{
      const elements=[document.documentElement,document.querySelector('.app-topbar'),document.querySelector('.page.active')];
      return elements.map(el=>({name:el.id||el.className||el.tagName,width:el.clientWidth,scroll:el.scrollWidth})).filter(el=>el.scroll>el.width+1);
    });
    assert.deepEqual(result,[],label);
  };
  const desktopGeometry=()=>page.evaluate(()=>[...document.querySelectorAll('.app-topbar,.topbar-logo-mark,.sidebar,.page.active,.page.active .card,.page.active .task-table th,.page.active .task-table td,.page.active .form-control')].map(el=>{
    const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];
  }));
  const changedPixelRatio=(before,after)=>page.evaluate(async([a,b])=>{
    const read=async(data)=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,img.width,img.height).data;};
    const first=await read(a);const second=await read(b);let changed=0;
    for(let i=0;i<first.length;i+=4)if([0,1,2,3].some(c=>first[i+c]!==second[i+c]))changed++;
    return changed/(first.length/4);
  },[before.toString('base64'),after.toString('base64')]);
  for (const width of [320,390,430,640]) {
    await page.setViewportSize({width,height:844});await visit();
    for (const name of ['dashboard','tasks','week','month','monthly','goals','guidelines','clients','team','recurring','settings','calendar','focus','mywork']) {
      await page.evaluate(name=>window.__mobileQA.setPage(name),name);await noOverflow(`${name} at ${width}px`);
    }
    await page.evaluate(()=>showPage('tasks'));
    await page.getByRole('button',{name:'Filters',exact:true}).click();
    await page.locator('#filter-bar [name="assigned"]').selectOption('teammate');await noOverflow(`expanded filters at ${width}px`);
    await page.getByRole('button',{name:'Filters (1 active)',exact:true}).click();
    assert.equal(await page.locator('#main-task-body [data-task-id="task-0"]').evaluate(el=>getComputedStyle(el).display),'grid');
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    assert.equal(await page.locator('#main-content').evaluate(el=>el.inert),true);
    await page.getByRole('button',{name:'Close navigation'}).click();
    assert.equal(await page.locator('#main-content').evaluate(el=>el.inert),false);
    for (const [action,id] of [['openClientModal','client-modal'],['openGoalModal','goal-modal'],['openRecurringModal','recurring-modal'],['editUser','user-modal']]) {
      await page.evaluate(([action])=>window[action](action==='editUser'?'teammate':undefined),[action]);
      const bounds=await page.locator(`#${id} .modal`).boundingBox();
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=845,`${id} at ${width}px`);
      assert.equal(await page.locator(`#${id} .modal`).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      await page.locator(`#${id} .modal-close`).click();
    }
    await page.locator('#mobile-quick-add').click();await page.locator('#qa-name').fill('Keep this mobile draft');
    await page.getByRole('button',{name:'Board',exact:true}).click();
    await noOverflow(`Board at ${width}px`);
    assert.equal(await page.locator('#task-board .board-drag-handle').first().isVisible(),false);
    await page.locator('#task-board [data-task-id="task-0"] .board-move').selectOption('review');
    await page.locator('#task-board [data-board-status="review"] [data-task-id="task-0"]').waitFor();
    await page.getByRole('button',{name:'Table',exact:true}).click();
    assert.equal(await page.locator('#qa-name').inputValue(),'Keep this mobile draft');
    await page.locator('#main-task-body [data-task-id="task-0"] [data-open-task]').click();
    assert.equal((await page.locator('#detail-brief').inputValue()).length>1000,true);
    assert.equal(await page.locator('#detail-brief').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    assert.equal(await page.locator('#task-details').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await page.getByRole('button',{name:'Close task details'}).click();
    await page.getByRole('button',{name:'+ Add Task',exact:true}).click();
    await page.setViewportSize({width,height:500});
    const modal=await page.locator('#task-modal .modal').boundingBox();
    assert.ok(modal.x>=0 && modal.x+modal.width<=width+1 && modal.y+modal.height<=501,`task modal at ${width}px`);
    assert.equal(await page.locator('#task-modal .form-row').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
    await page.locator('#task-modal .modal-close').click();
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>window.__mobileQA.setTimer());await noOverflow(`floating timer at ${width}px`);
    const timer=await page.locator('#focus-floating-window').boundingBox();assert.ok(timer.x>=0 && timer.x+timer.width<=width+1);
    await page.evaluate(()=>setFocusRunningView('fullscreen',true));await noOverflow(`fullscreen timer at ${width}px`);
    assert.equal(await page.locator('.app-topbar').isVisible(),false);
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    assert.equal(await page.locator('.app-topbar').isVisible(),true);
    await page.evaluate(()=>showPage('tasks'));
    await page.evaluate(()=>window.__mobileQA.stopTimer());
    await page.evaluate(()=>window.__mobileQA.setRole('team'));
    assert.equal(await page.locator('#mobile-quick-add').isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'+ Add Task',exact:true}).isVisible(),true);
    console.log(`PASS mobile ${width}px: pages, drawer, cards, Board, drafts, forms, permissions and timer`);
    if (width===390) await page.screenshot({path:'/tmp/bingeberry-mobile-390.png'});
    for (const mode of ['signin','signup','recovery']) {
      await page.evaluate(mode=>window.__mobileQA.showAuth(mode),mode);
      assert.equal(await page.locator('.auth-box').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      const box=await page.locator('.auth-box').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1);
      assert.equal(await page.locator('#auth-user').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    }
    await page.evaluate(()=>window.__mobileQA.confirmEmail());
    assert.equal(await page.locator('.signup-confirmation').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  }
  await context.close();
  const desktop=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  await desktop.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  page=await desktop.newPage();page.on('pageerror',error=>errors.push(error.message));
  for (const width of [641,1280,1440]) {
    await page.setViewportSize({width,height:900});
    for (const name of ['tasks','dashboard','settings']) {
      await visit(`${base}/?baseline=1`);await page.evaluate(name=>showPage(name),name);
      const geometry=await desktopGeometry();
      const before=await page.screenshot({animations:'disabled'});
      await visit();await page.evaluate(name=>showPage(name),name);
      assert.deepEqual(await desktopGeometry(),geometry,`Desktop geometry changed for ${name} at ${width}px`);
      const after=await page.screenshot({animations:'disabled'});
      const ratio=before.equals(after)?0:await changedPixelRatio(before,after);
      if (ratio>0.0001) {
        await writeFile('/tmp/bingeberry-desktop-before.png',before);
        await writeFile('/tmp/bingeberry-desktop-after.png',after);
      }
      assert.ok(ratio<=0.0001,`Desktop ${name} changed at ${width}px (${ratio} changed pixels)`);
      assert.equal(await page.locator('#mobile-quick-add').isVisible(),false);
    }
    console.log(`PASS desktop ${width}px: identical geometry; screenshots match within 0.01% raster tolerance`);
  }
  assert.deepEqual(errors,[],'Browser JavaScript errors');
  console.log('PASS mobile layout suite (local fixtures; no live backend requests)');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
