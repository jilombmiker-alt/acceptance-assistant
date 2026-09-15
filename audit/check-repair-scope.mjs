import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'runs/repair-scope-'+Date.now());await fs.mkdir(out);const observe=process.argv.includes('--observe'),checks=[];
async function scenario(name){
 const dir=path.join(out,name);await fs.mkdir(dir);const app=await startWorkbench({allowedRoot:dir,stateDir:path.join(dir,'state')});
 const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([^"]+)"/)[1];
 const post=async(route,data)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
 const state=async()=>await(await fetch(app.origin+'/state')).json();
 const upload=async(text,input=true)=>post('/import-project',{files:[{path:'index.html',data:Buffer.from('<!doctype html><html><meta charset="utf-8"><title>Scope case</title><h1>'+text+'</h1>'+(input?'<label>Name<input id="name"></label>':'')+'</html>').toString('base64')}]});
 const run=async task=>{await post('/start',{taskId:task.id,revision:task.revision,digest:task.digest,confirmed:true});await app.wait();return state();};
 try{
  let s=await post('/prepare',{...await upload('Draft'),goal:'检查输入框和页面',expectedText:'Ready',normalRuns:2});s=await run(s.task);const before=s.task;
  s=await post('/prepare',{...await upload('Ready',name!=='missing-control'),repairFrom:{taskId:before.id,revision:before.revision}});
  assert.deepEqual(s.task.plan.paths.map(p=>p.id),['entry','expected-text','input-0']);
  if(name==='excluded-before-run')s=await post('/revise',{taskId:s.task.id,revision:s.task.revision,excludedPaths:['expected-text']});
  s=await run(s.task);const completedRepair=s.repair;
  if(name==='excluded-after-run'){
   assert.equal(s.repair.status,'verified-repair');
   s=await post('/revise',{taskId:s.task.id,revision:s.task.revision,excludedPaths:['expected-text']});
  }
  const result=await(await fetch(app.origin+'/results.json')).json();
  const html=await(await fetch(app.origin+'/report')).text(),context=await(await fetch(app.origin+'/codex-context.md')).text();
  await fs.writeFile(path.join(dir,'report.html'),html);await fs.writeFile(path.join(dir,'context.md'),context);await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(s,null,2));
  const row={name,status:s.repair.status,reason:s.repair.reason,completedStatus:completedRepair.status,groups:result.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length})),userTimeSavedMs:s.repair.userTimeSavedMs};checks.push(row);
  if(!observe){
   assert.notEqual(s.repair.status,'verified-repair');assert.equal(s.repair.userTimeSavedMs,null);
   assert.ok(html.includes(s.repair.reason));assert.ok(context.includes(s.repair.reason));
   if(name==='missing-control'){assert.equal(row.groups.find(g=>g.id==='input-0').status,'unverified');assert.equal(row.groups.find(g=>g.id==='expected-text').status,'pass');}
   if(name==='excluded-before-run')assert.equal(s.repair.status,'unverified');
   if(name==='excluded-after-run'){
    assert.equal(s.repair.status,'criteria-changed');assert.ok(!html.includes(completedRepair.reason));assert.ok(!context.includes(completedRepair.reason));
    assert.deepEqual(row.groups.map(g=>g.id),['entry','expected-text','input-0']);
   }
  }
 }finally{await app.end();await app.close();}
}
for(const name of ['missing-control','excluded-before-run','excluded-after-run'])await scenario(name);
const summary={scope:'受控静态网页；原控件移除与原检查范围缩小，非独立项目准确率',observeOnly:observe,checks};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
