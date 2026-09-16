import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';
import {browserEngine} from '../lib/browser.mjs';
const out=path.resolve(process.argv[2]||'state/snapshot-draft-audit');await fs.mkdir(out,{recursive:true});
const stateDir=path.join(out,'state');let app=await startWorkbench({allowedRoot:out,stateDir}),token;
const records=[];
const auth=async()=>{const html=await(await fetch(app.origin+'/connect')).text();token=html.match(/data-task-token="([a-f0-9]+)"/)[1];return html;};
const state=async()=>await(await fetch(app.origin+'/state')).json();
async function post(route,data,status=200){const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const upload=async(text,input=true)=>post('/import-project',{files:[{path:'index.html',data:Buffer.from('<meta charset="utf-8"><title>重传复检</title><h1>'+text+'</h1>'+(input?'<label>书名<input id="title"></label>':'')).toString('base64')}]});
const reupload=async(project,s)=>post('/prepare',{...project,repairFrom:{taskId:s.task.id,revision:s.task.revision}});
const execute=async(s)=>{await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});await app.wait();return state();};
let browser;
try{
 await auth();const a=await upload('Draft');let s=await post('/prepare',{...a,goal:'检查输入框和手机适配',expectedText:'Ready',normalRuns:2});s=await execute(s);const baseline=s;
 const baselineFile=path.join(stateDir,baseline.task.id,'run/results.json'),baselineBytes=await fs.readFile(baselineFile);
 const b=await upload('Ready');s=await reupload(b,s);const draft=s;
 assert.equal(s.receipt,false);assert.equal(s.repair.beforeTaskId,baseline.task.id);
 await app.close();app=await startWorkbench({allowedRoot:out,stateDir});const html=await auth();s=await state();
 const restart={case:'draft-restart',snapshotUnavailable:s.resumeDraft.available===false,baselineRetained:s.repair.beforeTaskId===baseline.task.id,choiceAvailable:html.includes('id="same-project"'),receipt:s.receipt};records.push(restart);
 if(process.argv.includes('--observe')){
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({observationOnly:true,records},null,2));console.log(JSON.stringify({observationOnly:true,records}));
 }else{
  assert.equal(restart.choiceAvailable,true);assert.equal(restart.receipt,false);
  browser=await(await browserEngine()).launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(app.origin+'/');await page.getByRole('link',{name:'重新选择文件夹',exact:true}).waitFor();
  assert.match(await page.locator('#chat-answer').innerText(),/原标准/);await page.screenshot({path:path.join(out,'restart-mobile.png'),fullPage:true});
  await page.goto(app.origin+'/connect');assert.equal(await page.locator('#same-project').isChecked(),false);await page.locator('#same-project').check();
  assert.equal(await page.locator('#expected').inputValue(),'Ready');assert.equal(await page.locator('#expected').getAttribute('readonly'),'');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'frozen-reupload-mobile.png'),fullPage:true});await browser.close();browser=null;
  const c=await upload('Ready'),from={taskId:draft.task.id,revision:draft.task.revision};
  assert.match((await post('/prepare',{...c,repairFrom:from,expectedText:'Draft'},400)).error,/保留原标准/);
  await fs.writeFile(baselineFile,Buffer.concat([baselineBytes,Buffer.from('\n')]));
  try{await post('/prepare',{...c,repairFrom:from},400);assert.equal((await state()).task.id,draft.task.id);}
  finally{await fs.writeFile(baselineFile,baselineBytes);}
  records.push({case:'changed-standard-and-tampered-baseline',rejected:true,priorTaskPreserved:true});
  s=await reupload(c,s);assert.equal(s.repair.beforeTaskId,baseline.task.id);assert.equal(s.receipt,false);
  const next=await upload('Ready');s=await reupload(next,s);assert.equal(s.repair.beforeTaskId,baseline.task.id);assert.equal(s.task.sources.repair.taskId,baseline.task.id);
  assert.deepEqual(s.task.plan.paths.map(p=>p.id),baseline.task.plan.paths.map(p=>p.id));assert.equal(s.task.expectedText,'Ready');assert.equal(s.task.normalRuns,2);
  s=await execute(s);assert.equal(s.repair.status,'verified-repair');assert.deepEqual(s.repair.fixed,['expected-text']);assert.equal(s.repair.beforeCriteriaHash,s.repair.afterCriteriaHash);assert.notEqual(s.repair.beforeProgramHash,s.repair.afterProgramHash);
  const actual=await(await fetch(app.origin+'/results.json')).json();assert.ok(actual.execution.groups.every(g=>g.status==='pass'&&g.records.length===2));
  await fs.writeFile(path.join(out,'repair.json'),JSON.stringify(s.repair,null,2));
  records.push({case:'repeated-draft-reupload',baseline:'original-completed-run',draftsExecuted:false,checks:actual.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length})),repair:s.repair.status,criteriaSame:true});
  const report=await(await fetch(app.origin+'/report')).text(),context=await(await fetch(app.origin+'/codex-context.md')).text();
  assert.ok(report.includes(baseline.task.id));assert.ok(context.includes(baseline.task.id));assert.ok(context.includes(s.repair.reason));
  records.push({case:'report-and-codex',originalCompletedBaseline:true,repairConclusionConsistent:true});
  if(process.argv.includes('--hold')){console.log('UI_REVIEW '+app.origin+' PID '+process.pid);await new Promise(r=>process.once('SIGUSR1',r));}
  const missing=await upload('Ready',false);s=await reupload(missing,s);s=await execute(s);
  const incomplete=await(await fetch(app.origin+'/results.json')).json();assert.equal(s.repair.status,'unverified');assert.equal(incomplete.execution.groups.find(g=>g.path.id==='input-0').status,'unverified');assert.equal(incomplete.execution.groups.length,4);
  records.push({case:'missing-control-retains-original-check',paths:incomplete.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length})),repair:s.repair.status});
  const revised=await upload('Ready');s=await reupload(revised,s);
  s=await post('/revise',{taskId:s.task.id,revision:s.task.revision,expectedText:'Different',excludedPaths:[]});
  assert.doesNotMatch(await auth(),/id="same-project"/);
  await post('/prepare',{...revised,repairFrom:{taskId:s.task.id,revision:s.task.revision}},400);
  records.push({case:'edited-draft',originalStandardReupload:false,changedDraftNotAccepted:true});
  assert.deepEqual(await fs.readFile(baselineFile),baselineBytes);
  const summary={scope:'Controlled local snapshots; unfinished drafts are not execution evidence',records,userTimeSavedMs:null};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }
}finally{await browser?.close();await app.end();await app.close();}
