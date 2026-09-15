import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startWorkbench} from '../v3/workbench.mjs';
import {startStaticProject} from '../v2/static-server.mjs';
const out=path.resolve(process.argv[2]||'runs/repair-workflow-'+Date.now());
await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const project=path.join(out,'project'),stateDir=path.join(out,'workbench');await fs.mkdir(project);
const html=text=>'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>复检样例</title><h1>'+text+'</h1></html>';
await fs.writeFile(path.join(project,'index.html'),html('旧内容'));
const site=await startStaticProject(project);let app=await startWorkbench({allowedRoot:project,stateDir});
let token;const checks=[];
async function authenticate(){token=(await(await fetch(app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];}await authenticate();
const state=async()=>await(await fetch(app.origin+'/state')).json();
async function post(route,data){const s=await state();const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task?.id,revision:s.task?.revision})})});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
async function run(expectedText='目标内容'){
 const s=await post('/prepare',{projectPath:project,url:site.url,mode:'basic',goal:'检查页面明确文字',expectedText,normalRuns:2});
 await post('/start',{confirmed:true,digest:s.task.digest});await app.wait();return state();
}
try{
 const before=await run();assert.equal(before.repair,null);checks.push('first-run-has-no-invented-baseline');
 await fs.writeFile(path.join(project,'index.html'),html('目标内容'));
 const after=await run();assert.equal(after.repair.status,'verified-repair');assert.deepEqual(after.repair.fixed,['expected-text']);assert.equal(after.repair.userTimeSavedMs,null);checks.push('same-directory-actual-fix-linked');
 await fs.writeFile(path.join(out,'after.json'),JSON.stringify(after,null,2));
 const report=await(await fetch(app.origin+'/report')).text();assert.match(report,/本次复检/);assert.match(report,/同一项目的修改版本/);await fs.writeFile(path.join(out,'report.html'),report);checks.push('html-report-and-json-match');
 await app.close();app=await startWorkbench({allowedRoot:project,stateDir});await authenticate();assert.equal((await state()).repair.status,'verified-repair');checks.push('restart-retains-link');
 const prior=path.join(stateDir,before.task.id,'run','results.json'),raw=await fs.readFile(prior);await fs.appendFile(prior,' ');assert.equal((await state()).repair.status,'unverified');await fs.writeFile(prior,raw);assert.equal((await state()).repair.status,'verified-repair');checks.push('tampered-baseline-refuses-repair-claim');
 const repeated=await run();assert.equal(repeated.repair.status,'same-version-repeat');checks.push('same-version-repeat-not-repair');
 const changed=await run('另一个要求');assert.equal(changed.repair.status,'criteria-changed');checks.push('changed-criteria-not-repair');
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({scope:'真实本机工作台任务、HTML 报告与证据关联；当前仅同目录同页面，文件夹重导入尚未关联',checks,baselineTask:before.task.id,repairTask:after.task.id,comparison:after.repair},null,2));console.log(JSON.stringify({out,checks},null,2));
}finally{await app.end();await app.close();await new Promise(r=>site.server.close(r));}
