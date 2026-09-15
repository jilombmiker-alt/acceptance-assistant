import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'runs/snapshot-repair-'+Date.now());await fs.mkdir(out,{recursive:true});
const stateDir=path.join(out,'state');let app=await startWorkbench({allowedRoot:out,stateDir}),token;
const checks=[];
async function auth(){token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([^"]+)"/)[1];}await auth();
async function post(route,data,status=200){const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const state=async()=>await(await fetch(app.origin+'/state')).json();
const source=text=>'<!doctype html><html><meta charset="utf-8"><title>Snapshot case</title><h1>'+text+'</h1><label>Name<input id="name"></label></html>';
const upload=async text=>post('/import-project',{files:[{path:'index.html',data:Buffer.from(source(text)).toString('base64')}]});
async function execute(task){await post('/start',{taskId:task.id,revision:task.revision,digest:task.digest,confirmed:true});await app.wait();return state();}
try{
 const first=await upload('Draft');let s=await post('/prepare',{...first,goal:'检查输入框和手机适配',expectedText:'Ready',normalRuns:3});s=await execute(s.task);
 assert.equal(s.repair,null);const before=s;const original=await fs.readFile(path.join(first.projectPath,'index.html'));checks.push('first-upload-independent');
 const page=await(await fetch(app.origin+'/connect')).text();assert.match(page,/这是当前项目的修改版/);assert.ok(!page.includes('id="same-project" checked'));checks.push('same-project-choice-explicit-default-off');
 await app.close();app=await startWorkbench({allowedRoot:out,stateDir});await auth();assert.match(await(await fetch(app.origin+'/connect')).text(),/id="same-project"/);checks.push('restart-keeps-completed-baseline');
 const next=await upload('Ready'),from={taskId:before.task.id,revision:before.task.revision};
 assert.match((await post('/prepare',{...next,repairFrom:{...from,revision:99}},400)).error,/原任务已变化/);checks.push('stale-reference-refused');
 assert.match((await post('/prepare',{...next,repairFrom:from,expectedText:'changed'},400)).error,/保留原标准/);checks.push('changed-standard-not-silently-applied');
 assert.match((await post('/prepare',{...next,url:'http://127.0.0.1:1/',repairFrom:from},400)).error,/不得替换/);checks.push('other-url-refused');
 s=await post('/prepare',{...next,repairFrom:from});assert.equal(s.task.normalRuns,3);assert.equal(s.task.expectedText,'Ready');assert.equal(s.task.goal,before.task.goal);assert.deepEqual(s.task.plan.paths.map(p=>p.id),before.task.plan.paths.map(p=>p.id));s=await execute(s.task);
 assert.equal(s.repair.status,'verified-repair');assert.equal(s.repair.beforeCriteriaHash,s.repair.afterCriteriaHash);assert.deepEqual(s.repair.fixed,['expected-text']);assert.equal(s.repair.userTimeSavedMs,null);assert.match(s.repair.scope,/用户确认/);assert.deepEqual(await fs.readFile(path.join(first.projectPath,'index.html')),original);checks.push('changed-upload-original-standard-repair');
 const results=await(await fetch(app.origin+'/results.json')).json();assert.ok(results.execution.groups.every(g=>g.records.length===3));checks.push('all-four-original-paths-three-repetitions');
 await fs.writeFile(path.join(out,'repair.json'),JSON.stringify(s.repair,null,2));await fs.writeFile(path.join(out,'report.html'),await(await fetch(app.origin+'/report')).text());
 const repeat=await upload('Ready');s=await post('/prepare',{...repeat,repairFrom:{taskId:s.task.id,revision:s.task.revision}});s=await execute(s.task);assert.equal(s.repair.status,'same-version-repeat');checks.push('same-upload-not-a-repair');
 const separate=await upload('Independent project');s=await post('/prepare',{...separate,goal:'检查页面',expectedText:'Independent project',normalRuns:2});s=await execute(s.task);assert.equal(s.repair,null);checks.push('new-project-without-confirmation-independent');
 const summary={scope:'受控静态网页上传，明确同项目声明；非自动身份识别、非陌生项目迁移',checks,userTimeSavedMs:null};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({out,...summary},null,2));
}finally{await app.end();await app.close();}
