import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'state/observation-exports');await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({allowedRoot:out,stateDir:path.join(out,'state')});
const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1];
async function post(route,data){const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const state=async()=>await(await fetch(app.origin+'/state')).json();
const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
async function upload(assets){const files=[file('index.html','<meta charset="utf-8"><title>接入观察交接</title><link rel="stylesheet" href="/app.css"><h1>Ready</h1><div id="slot"></div><script src="/app.js"></script>')];if(assets)files.push(file('app.js',"document.getElementById('slot').innerHTML='<label>书名<input id=title></label>';"),file('app.css','body{font-family:system-ui}'));return post('/import-project',{files});}
async function execute(s){await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});await app.wait();return state();}
const records=[];
try{
 let project=await upload(true),s=await post('/prepare',{...project,goal:'检查输入框',normalRuns:2});s=await execute(s);assert.deepEqual(s.task.plan.paths.map(p=>p.id),['entry','input-0']);
 for(const assets of [false,true]){
  const name=assets?'restored':'missing';project=await upload(assets);s=await post('/prepare',{...project,repairFrom:{taskId:s.task.id,revision:s.task.revision}});s=await execute(s);
  assert.equal(s.repair.status,'unverified');assert.equal(s.repair.beforeCriteriaHash,s.repair.afterCriteriaHash);
  const notes=s.task.gaps.filter(g=>['intake','observation','mapping','document-unavailable'].includes(g.kind));assert.equal(notes.length,assets?0:2);
  const mdResponse=await fetch(app.origin+'/codex-context.md');assert.equal(mdResponse.status,200);const md=await mdResponse.text();assert.match(md,/本计划的接入观察/);
  if(assets){assert.match(md,/本计划未记录此类接入缺项/);assert.ok(!md.includes('当前上传版本有未读取的请求'));}
  else for(const n of notes)assert.ok(md.includes(n.reason));
  await fs.writeFile(path.join(out,name+'.md'),md);
  const response=await fetch(app.origin+'/report.pdf');assert.equal(response.status,200,await(response.status===200?Promise.resolve(''):response.text()));
  const bytes=Buffer.from(await response.arrayBuffer()),hash=bodyHash(bytes);assert.equal(response.headers.get('x-report-sha256'),hash);assert.equal(bytes.subarray(0,4).toString(),'%PDF');await fs.writeFile(path.join(out,name+'.pdf'),bytes);
  const cached=await fetch(app.origin+'/report.pdf');assert.equal(bodyHash(Buffer.from(await cached.arrayBuffer())),hash);
  const result=await(await fetch(app.origin+'/results.json')).json();assert.ok(result.execution.groups.every(g=>g.status===(assets?'pass':'unverified')&&g.records.length===(assets?2:1)));
  records.push({case:name,file:name+'.pdf',sha256:hash,codexHash:bodyHash(md),notes:notes.map(g=>g.reason),repair:s.repair.status,criteriaSame:true,cacheStable:true,paths:result.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length}))});
 }
 assert.notEqual(records[0].sha256,records[1].sha256);assert.notEqual(records[0].codexHash,records[1].codexHash);
 const summary={scope:'Two local basic paths; missing and restored resources with frozen criteria',records,userTimeSavedMs:null,pdfReview:'pending'};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await app.end();await app.close();}
