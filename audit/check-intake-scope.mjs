import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {browserEngine} from '../lib/browser.mjs';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'state/intake-scope-audit');
await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({allowedRoot:out,stateDir:path.join(out,'state')});
const browser=await (await browserEngine()).launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const read=async()=>await(await fetch(app.origin+'/state')).json();
const records=[];
try{
 for(const [name,goal,input,execute] of [
  ['unsupported-business','新增书目、保存并导出，不检查视频',false,true],
  ['missing-input','检查输入框',false,false],
  ['supported-basics','检查输入框和手机适配',true,true]
 ]){
  const source=path.join(out,name);await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'index.html'),'<meta charset="utf-8"><title>记录工具</title><h1>Ready</h1>'+(input?'<label>书名<input id="title"></label>':''));
  await page.goto(app.origin+'/connect');
  assert.match(await page.locator('main').innerText(),/上传成功不等于完成业务验收/);
  await page.locator('#folder').setInputFiles(source);
  await page.locator('#goal').fill(goal);
  await page.locator('#expected').fill(input?'Ready':'');
  await Promise.all([page.waitForURL(app.origin+'/'),page.locator('#import').click()]);
  await page.locator('#chat-start').waitFor();
  const state=await read(),guide=state.scopeGuide;
  const visible=await page.locator('#chat-answer').innerText();
  assert.match(visible,/目标中的其他业务流程尚未验证/);
  assert.doesNotMatch(visible,/接下来检查“/);
  assert.deepEqual(guide.checks.map(c=>c.id),input?['entry','expected-text','input-0','layout']:['entry']);
  if(name==='unsupported-business'){
   assert.match(visible,/尚未对应：导出、保存/);
   assert.doesNotMatch(visible,/视频/); // Exclusions stay collapsed, not labelled unsupported.
  }
  if(name==='missing-input')assert.match(visible,/未观察到支持的普通输入框/);
  await page.screenshot({path:path.join(out,name+'-plan.png'),fullPage:true});
  if(execute){
   await Promise.all([page.waitForResponse(r=>r.url()===app.origin+'/start'&&r.request().method()==='POST'),page.locator('#chat-start').click()]);
   await app.wait();await page.reload();await page.locator('#chat-answer a[href="/report"]').waitFor();
   const result=await(await fetch(app.origin+'/results.json')).json();
   assert.ok(result.execution.groups.every(g=>g.status==='pass'&&g.records.length===2));
   assert.match(await page.locator('#chat-answer').innerText(),/目标中的其他业务流程尚未验证/);
   records.push({name,paths:result.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length})),uncovered:guide.uncovered});
  }else records.push({name,paths:guide.checks.map(c=>c.id),warnings:guide.warnings,executed:false});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,name+'-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  if(name==='missing-input'){
   const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1];
   const revised=await fetch(app.origin+'/revise',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({taskId:state.task.id,revision:state.task.revision,excludedPaths:['entry']})});
   assert.equal(revised.status,200);await page.reload();
   await page.getByRole('link',{name:'调整检查范围',exact:true}).waitFor();
   assert.equal(await page.locator('#chat-start').count(),0);
   assert.match(await page.locator('#chat-answer').innerText(),/没有可执行检查/);
   records.at(-1).emptyScopeHasNoStartButton=true;
  }
 }
 // A copied business-looking folder is still not the server-reviewed business root.
 const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1],state=await read();
 const denied=await fetch(app.origin+'/prepare',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({projectPath:state.resumeDraft.projectPath,url:state.resumeDraft.url,mode:'reviewed-reading',normalRuns:2})});
 assert.equal(denied.status,400);assert.equal((await read()).task.id,state.task.id);
 assert.deepEqual(errors,[]);
 const summary={scope:'Controlled local folder upload and basic checks only; no arbitrary business acceptance',records,unauthorizedBusinessTemplateRejected:true,browserErrors:errors,humanTimeSavedMs:null};
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 await browser.close();
 if(process.argv.includes('--hold')){console.log('UI_REVIEW '+app.origin+' PID '+process.pid);await new Promise(resolve=>process.once('SIGUSR1',resolve));}
}finally{await browser.close();await app.end();await app.close();}
