import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'state/snapshot-observation-audit');await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({allowedRoot:out,stateDir:path.join(out,'state')});const records=[];
const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1];
const state=async()=>await(await fetch(app.origin+'/state')).json();
async function post(route,data){const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
async function upload(title,assets){const files=[file('index.html','<meta charset="utf-8"><title>资源复检</title><link rel="stylesheet" href="/app.css"><h1>'+title+'</h1><div id="slot"></div><script src="/app.js"></script>')];if(assets)files.push(file('app.js',"document.getElementById('slot').innerHTML='<label>书名<input id=title></label>';"),file('app.css','body{font-family:system-ui}'));return post('/import-project',{files});}
async function execute(s){await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});await app.wait();return state();}
try{
 let project=await upload('Draft',true);let s=await post('/prepare',{...project,goal:'检查输入框和手机适配',expectedText:'Ready',normalRuns:2});s=await execute(s);const original=s.task;
 assert.equal(s.scopeGuide.warnings.length,0);
 project=await upload('Ready',false);s=await post('/prepare',{...project,repairFrom:{taskId:s.task.id,revision:s.task.revision}});
 const missing={case:'missing-resources-plan',blocked:s.observation.blocked.map(b=>b.path),observedFields:s.observation.fields.length,warnings:s.scopeGuide.warnings,checks:s.task.plan.paths.map(p=>p.id)};records.push(missing);
 assert.equal(missing.blocked.length,2);assert.equal(missing.observedFields,0);assert.deepEqual(missing.checks,original.plan.paths.map(p=>p.id));
 if(process.argv.includes('--observe')){
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({observationOnly:true,records},null,2));console.log(JSON.stringify({observationOnly:true,records}));
 }else{
  assert.ok(s.task.gaps.some(g=>g.kind==='observation'));assert.ok(s.task.gaps.some(g=>g.kind==='mapping'));
  assert.ok(!s.task.proposedScope.requests.some(r=>new RegExp('^(?:'+r.pathPattern+')$').test('/app.js')));
  await fs.writeFile(path.join(out,'missing-plan.json'),JSON.stringify(s,null,2));
  if(process.argv.includes('--hold')){console.log('UI_REVIEW '+app.origin+' PID '+process.pid);await new Promise(r=>process.once('SIGUSR1',r));}
  s=await execute(s);const missingResults=await(await fetch(app.origin+'/results.json')).json();assert.equal(s.repair.status,'unverified');assert.ok(missingResults.execution.groups.every(g=>g.status==='unverified'));
  const html=await(await fetch(app.origin+'/report')).text();assert.ok(html.includes(missing.warnings[0]));
  records.push({case:'missing-resources-run',repair:s.repair.status,paths:missingResults.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length}))});
  project=await upload('Ready',true);s=await post('/prepare',{...project,repairFrom:{taskId:s.task.id,revision:s.task.revision}});
  assert.equal(s.observation.blocked.length,0);assert.equal(s.observation.fields.length,1);assert.deepEqual(s.scopeGuide.warnings,[]);assert.ok(!s.task.gaps.some(g=>['observation','mapping'].includes(g.kind)));
  assert.equal(s.task.expectedText,original.expectedText);assert.equal(s.task.normalRuns,original.normalRuns);assert.deepEqual(s.task.plan.paths.map(p=>p.id),original.plan.paths.map(p=>p.id));
  s=await execute(s);const restored=await(await fetch(app.origin+'/results.json')).json();assert.ok(restored.execution.groups.every(g=>g.status==='pass'&&g.records.length===2));assert.equal(s.repair.beforeCriteriaHash,s.repair.afterCriteriaHash);assert.equal(s.repair.status,'unverified');
  records.push({case:'restored-resources',warnings:s.scopeGuide.warnings,criteriaSame:true,repair:s.repair.status,paths:restored.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length}))});
  const summary={scope:'Controlled static reuploads; current observations change, frozen criteria do not',records,userTimeSavedMs:null};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }
}finally{await app.end();await app.close();}
