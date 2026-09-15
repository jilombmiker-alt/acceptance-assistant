import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startStaticProject} from '../v2/static-server.mjs';
const out=path.resolve(process.argv[2]||'runs/interrupted-repair-'+Date.now());await fs.mkdir(out);const project=path.join(out,'project');await fs.mkdir(project);const stateDir=path.join(out,'state');
const source=text=>'<!doctype html><html><meta charset="utf-8"><title>Resume case</title><h1>'+text+'</h1>'+Array.from({length:5},(_,i)=>'<label>Field '+i+'<input id="field-'+i+'"></label>').join('')+'</html>';
await fs.writeFile(path.join(project,'index.html'),source('Draft'));const site=await startStaticProject(project);let child,origin,token;const checks=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(){
 const code="import {startWorkbench} from './v3/workbench.mjs';const app=await startWorkbench({allowedRoot:process.env.AUDIT_PROJECT,stateDir:process.env.AUDIT_STATE});process.send({origin:app.origin});";
 child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,AUDIT_PROJECT:project,AUDIT_STATE:stateDir},detached:true,stdio:['ignore','ignore','pipe','ipc']});
 let errors='';child.stderr.on('data',b=>{errors+=b;});
 const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('workbench exited: '+errors);})]);origin=message[0].origin;
 token=(await(await fetch(origin)).text()).match(/data-task-token="([^"]+)"/)[1];
}
async function stop(){if(!child)return;const c=child;child=null;const exited=once(c,'exit');try{process.kill(-c.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}await exited;}
const state=async()=>await(await fetch(origin+'/state')).json();
async function post(route,data){const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});const s=await r.json();assert.equal(r.status,200,JSON.stringify(s));return s;}
async function until(predicate){const deadline=Date.now()+45000;while(Date.now()<deadline){const s=await state();if(await predicate(s))return s;await delay(35);}throw Error('audit timed out');}
async function start(){const s=await post('/prepare',{projectPath:project,url:site.url,goal:'检查页面输入框',expectedText:'Ready',normalRuns:2});await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});return s;}
try{
 await boot();let s=await start();await until(async x=>x.control?.reportAvailable&&JSON.parse(await fs.readFile(path.join(stateDir,x.task.id,'session.json'),'utf8')).repairSealHash);checks.push('baseline-completed-and-sealed');
 await fs.writeFile(path.join(project,'index.html'),source('Ready'));s=await start();const taskId=s.task.id;
 s=await until(async x=>{try{return x.control?.worker?.running&&(JSON.parse(await fs.readFile(path.join(stateDir,taskId,'run/checkpoint.json'),'utf8'))).groups.some(g=>g.records?.some(r=>r.status==='pass'));}catch{return false;}});
 s=await post('/command',{taskId,revision:s.task.revision,command:'pause',expectedControlRevision:s.control.control.revision});await until(x=>x.control?.worker?.phase==='paused');
 if(!process.argv.includes('--observe')){
  s=await post('/command',{taskId,revision:s.task.revision,command:'resume',expectedControlRevision:s.control.control.revision});
  s=await post('/command',{taskId,revision:s.task.revision,command:'pause',expectedControlRevision:s.control.control.revision});
  await until(x=>x.control?.worker?.phase==='paused');checks.push('live-pause-resume-does-not-wait-for-completion');
 }
 const oldRun=s.control.worker.runId;const checkpoint=await fs.readFile(path.join(oldRun,'checkpoint.json'));await stop();checks.push('real-process-stopped-after-checkpoint');
 await boot();s=await state();assert.equal(s.task.id,taskId);assert.equal(s.control.interrupted,true);checks.push('restart-recognizes-original-interrupted-task');
 if(!process.argv.includes('--observe')){
  await fs.writeFile(path.join(project,'index.html'),source('Changed after interruption'));
  const rejected=await fetch(origin+'/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({taskId,revision:s.task.revision,command:'resume',expectedControlRevision:s.control.control.revision})});
  assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/源码已变化/);assert.equal((await state()).control.worker.runId,oldRun);
  await fs.writeFile(path.join(project,'index.html'),source('Ready'));checks.push('changed-source-refused-before-resume');
 }
 s=await post('/command',{taskId,revision:s.task.revision,command:'resume',expectedControlRevision:s.control.control.revision});
 s=await until(x=>x.control?.reportAvailable&&x.control.worker.runId!==oldRun);if(!process.argv.includes('--observe'))await until(x=>x.repair?.status==='verified-repair');else await delay(150);s=await state();
 assert.deepEqual(await fs.readFile(path.join(oldRun,'checkpoint.json')),checkpoint);const result=await(await fetch(origin+'/results.json')).json();assert.ok(result.execution.groups.every(g=>g.status==='pass'&&g.records.length===2));assert.ok(result.execution.groups.some(g=>g.records.some(r=>r.id.startsWith('previous/'))));checks.push('resume-retains-checkpoint-and-completed-records');
 if(!process.argv.includes('--observe')){
  assert.equal(s.repair.status,'verified-repair');await stop();await boot();s=await state();assert.equal(s.repair.status,'verified-repair');checks.push('resumed-evidence-survives-second-restart');
  const currentRun=s.control.worker.runId;const record=result.execution.groups.flatMap(g=>g.records).find(r=>r.id.startsWith('previous/'));const file=path.join(currentRun,record.id+'.json');const bytes=await fs.readFile(file);await fs.writeFile(file,'{}');assert.equal((await state()).repair.status,'unverified');await fs.writeFile(file,bytes);assert.equal((await state()).repair.status,'verified-repair');checks.push('copied-record-tampering-invalidates-comparison');
 }
 if(!process.argv.includes('--observe')){
  await start();const next=await until(x=>x.repair?.status==='same-version-repeat');assert.equal(next.repair.beforeTaskId,taskId);checks.push('next-task-loads-resumed-baseline');
 }
 const summary={scope:'真实本机进程中断、同目录同页面基础检查恢复；受控案例',checks,repairStatus:s.repair?.status,reason:s.repair?.reason,groups:result.execution.groups.map(g=>({id:g.path.id,status:g.status,records:g.records.map(r=>r.id)})),userTimeSavedMs:s.repair?.userTimeSavedMs};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 if(!process.argv.includes('--observe'))assert.equal(s.repair.status,'verified-repair');
}finally{await stop();await new Promise(r=>site.server.close(r));}
