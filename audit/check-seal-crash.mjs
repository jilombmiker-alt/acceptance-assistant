import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {bodyHash} from '../lib/authorization.mjs';
import {startStaticProject} from '../v2/static-server.mjs';
const out=path.resolve(process.argv[2]||'runs/seal-crash-'+Date.now());await fs.mkdir(out);const observe=process.argv.includes('--observe'),summaries=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
for(const mode of ['before-index','before-session','session-write-error']){
 const dir=path.join(out,mode);await fs.mkdir(dir);const project=path.join(dir,'project');await fs.mkdir(project);const stateDir=path.join(dir,'state');const source=text=>'<!doctype html><meta charset="utf-8"><h1>'+text+'</h1><label>Name<input id="name"></label>';
 await fs.writeFile(path.join(project,'index.html'),source('Draft'));const site=await startStaticProject(project);let child,exited,origin,token;
 async function boot(baselineId=''){
  // Fault injection is confined to this child; production code has no crash switch.
  const code=`import fs from 'node:fs/promises';import path from 'node:path';import {startWorkbench} from './v3/workbench.mjs';
const write=fs.writeFile.bind(fs);fs.writeFile=async(file,data,...args)=>{
 const name=path.basename(String(file)),parent=path.basename(path.dirname(String(file)));
 if(process.env.AUDIT_BASELINE&&parent!==process.env.AUDIT_BASELINE&&parent.startsWith('task-')){
  const hit=process.env.AUDIT_CRASH==='before-index'?name==='repair-evidence.json':name.startsWith('session.json.')&&String(data).includes('"repairSealHash"');
  if(hit){if(process.env.AUDIT_CRASH==='session-write-error')throw Error('Injected session write failure');process.kill(process.pid,'SIGKILL');}
 }return write(file,data,...args);
};const app=await startWorkbench({allowedRoot:process.env.AUDIT_PROJECT,stateDir:process.env.AUDIT_STATE});process.send({origin:app.origin});`;
  child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,AUDIT_PROJECT:project,AUDIT_STATE:stateDir,AUDIT_BASELINE:baselineId,AUDIT_CRASH:mode},detached:true,stdio:['ignore','ignore','pipe','ipc']});
  let error='';child.stderr.on('data',b=>error+=b);exited=once(child,'exit');const msg=await Promise.race([once(child,'message'),exited.then(()=>{throw Error('boot failed: '+error);})]);origin=msg[0].origin;token=(await(await fetch(origin)).text()).match(/data-task-token="([^"]+)"/)[1];
 }
 async function stop(){if(!child)return;const c=child;child=null;if(c.exitCode===null&&c.signalCode===null){try{process.kill(-c.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}await exited;}
 const get=async route=>{const r=await fetch(origin+route);assert.equal(r.status,200);return r;};const state=async()=>await(await get('/state')).json();
 async function post(route,data){const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;}
 async function until(fn){const end=Date.now()+45000;while(Date.now()<end){const s=await state();if(await fn(s))return s;await delay(50);}throw Error('audit timed out');}
 const prepare=()=>post('/prepare',{projectPath:project,url:site.url,goal:'检查页面输入框',expectedText:'Ready',normalRuns:2});
 const start=s=>post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});
 try{
  await boot();let s=await prepare();await start(s);await until(async x=>x.control?.reportAvailable&&JSON.parse(await fs.readFile(path.join(stateDir,x.task.id,'session.json'),'utf8')).repairSealHash);const baselineId=s.task.id;await stop();
  await boot(baselineId);await fs.writeFile(path.join(project,'index.html'),source('Ready'));s=await prepare();const taskId=s.task.id;await start(s);
  if(mode==='session-write-error'){
   await until(x=>x.control?.reportAvailable&&x.learningError);await stop();
  }else{
   let timer;try{const [,signal]=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fault did not trigger')),45000);})]);assert.equal(signal,'SIGKILL');child=null;}finally{clearTimeout(timer);}
  }
  const folder=path.join(stateDir,taskId),resultFile=path.join(folder,'run/results.json'),raw=await fs.readFile(resultFile);const result=JSON.parse(raw);assert.ok(result.groups.every(g=>g.status==='pass'&&g.records.length===2));
  const saved=JSON.parse(await fs.readFile(path.join(folder,'session.json'),'utf8'));assert.ok(!saved.repairSealHash);let index=null;try{index=await fs.readFile(path.join(folder,'repair-evidence.json'));}catch(e){if(e.code!=='ENOENT')throw e;}assert.equal(!!index,mode!=='before-index');
  await boot();s=await state();assert.equal(s.task.id,taskId);assert.equal(s.control.reportAvailable,true);assert.deepEqual(await fs.readFile(resultFile),raw);
  const row={mode,completedChecks:result.groups.length,recordsPerCheck:2,indexExists:!!index,repairStatus:s.repair.status,reason:s.repair.reason,originalResultsHash:bodyHash(raw),userTimeSavedMs:s.repair.userTimeSavedMs};
  if(!observe){
   assert.equal(s.repair.status,'unverified');assert.match(s.repair.reason,/保存|封存/);assert.match(s.repair.reason,/新.*任务/);
   assert.equal((await(await get('/repair-comparison.json')).json()).status,'unverified');assert.match(await(await get('/report')).text(),/复检证据未确认/);assert.match(await(await get('/codex-context.md')).text(),/复检证据未确认/);
   const after=JSON.parse(await fs.readFile(path.join(folder,'session.json'),'utf8'));assert.ok(!after.repairSealHash);if(index)assert.deepEqual(await fs.readFile(path.join(folder,'repair-evidence.json')),index);
   await stop();await boot();assert.equal((await state()).repair.status,'unverified');
   let next=await prepare();await start(next);next=await until(x=>x.repair?.status==='verified-repair');assert.equal(next.repair.beforeTaskId,baselineId);assert.deepEqual(await fs.readFile(resultFile),raw);
   row.retryStatus=next.repair.status;row.checks=[mode==='session-write-error'?'actual-session-write-failure':'actual-crash-after-results','no-unanchored-seal-trusted','original-results-preserved','state-json-report-handoff-agree','second-restart-retains-unverified','fresh-task-reuses-verified-baseline'];
  }
  summaries.push(row);await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));console.log(JSON.stringify(row));
 }finally{await stop();await new Promise(r=>site.server.close(r));}
}
