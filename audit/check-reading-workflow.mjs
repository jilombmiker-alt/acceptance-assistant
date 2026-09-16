import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {startReadingRepairDemo} from '../v3/reading-repair-demo.mjs';
const out=path.resolve(process.argv[2]||'runs/reading-workflow-'+Date.now());await fs.mkdir(out);let demo=await startReadingRepairDemo({directory:out});let token;const checks=[];
const fixture=path.resolve(import.meta.dirname,'../projects/reading-list/app.js'),original=await fs.readFile(fixture);
const state=async()=>await(await fetch(demo.app.origin+'/state')).json();
async function auth(){token=(await(await fetch(demo.app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];}await auth();
async function post(route,data,expected=200){const s=await state();const r=await fetch(demo.app.origin+route,{method:'POST',headers:{Origin:demo.app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task.id,revision:s.task.revision})})});const x=await r.json();assert.equal(r.status,expected,JSON.stringify(x));return x;}
async function run(){let s=await state();await post('/start',{confirmed:true,digest:s.task.digest});await demo.app.wait();s=await state();const result=await(await fetch(demo.app.origin+'/results.json')).json();return {s,result:result.execution};}
try{
 let s=await state();assert.equal(s.task.mode,'reviewed-reading');assert.equal(s.receipt,false);assert.equal(s.task.plan.paths.length,11);const frozen=JSON.stringify(s.task.plan);await fs.writeFile(path.join(out,'frozen-plan.json'),frozen);checks.push('launcher-prepares-eleven-paths-without-starting');
 await post('/prepare',{projectPath:path.dirname(demo.project),url:demo.site.url+'index.html',mode:'reviewed-reading',reviewedRoot:path.dirname(demo.project)},400);checks.push('http-cannot-expand-reviewed-root');
 const before=await run();assert.deepEqual(before.result.groups.filter(g=>g.status==='issue').map(g=>g.path.id).sort(),['export','export-filter','export-refresh']);assert.equal(before.s.repair,null);checks.push('one-export-defect-observed-on-three-paths');
 const appFile=path.join(demo.project,'app.js'),broken=await fs.readFile(appFile,'utf8'),bad='({title,read})=>({title,read:false})',good='({title,read})=>({title,read})';assert.equal(broken.split(bad).length,2);await fs.writeFile(appFile,broken.replace(bad,good));
 await post('/prepare',{projectPath:demo.project,url:demo.site.url+'index.html',mode:'reviewed-reading',normalRuns:2});s=await state();assert.equal(JSON.stringify(s.task.plan),frozen);const after=await run();assert.equal(after.s.repair.status,'verified-repair');assert.deepEqual(after.s.repair.fixed.sort(),['export','export-filter','export-refresh']);assert.equal(after.s.repair.beforeCriteriaHash,after.s.repair.afterCriteriaHash);assert.notEqual(after.s.repair.beforeProgramHash,after.s.repair.afterProgramHash);checks.push('real-source-change-retested-through-workbench');
 const downloads=[];
 for(const [phase,run] of [['before',before],['after',after]]){
  assert.ok(run.result.groups.every(g=>g.records.length===2));if(phase==='after')assert.ok(run.result.groups.every(g=>g.status==='pass'));
  for(const g of run.result.groups.filter(g=>g.path.id.startsWith('export')))for(const r of g.records){assert.equal(r.outputs.length,1);const file=path.join(out,'workbench',run.s.task.id,'run',r.outputs[0]),bytes=await fs.readFile(file),actual=JSON.parse(bytes);assert.equal(actual.books.length,2);assert.deepEqual(actual.books.map(b=>b.title),['山海笔记','城市观察']);assert.equal(actual.books[0].read,phase==='before'||g.path.id==='export-unread'?false:true);assert.equal(actual.books[1].read,false);downloads.push({phase,check:g.path.id,sha256:bodyHash(bytes),actual});}
 }
 assert.equal(downloads.length,16);checks.push('sixteen-real-downloads-match-state-expectations');
 const html=await(await fetch(demo.app.origin+'/report')).text(),context=await(await fetch(demo.app.origin+'/codex-context.md')).text();assert.ok(html.includes(after.s.repair.reason));assert.ok(context.includes(after.s.repair.reason));assert.ok(context.includes(after.s.repair.beforeCriteriaHash));await fs.writeFile(path.join(out,'report.html'),html);await fs.writeFile(path.join(out,'context.md'),context);checks.push('html-and-codex-export-match-repair');
 const port=Number(new URL(demo.site.url).port);await demo.close();demo=await startReadingRepairDemo({directory:out,projectPort:port});await auth();assert.equal((await state()).repair.status,'verified-repair');assert.equal(await fs.readFile(appFile,'utf8'),broken.replace(bad,good));checks.push('restart-preserves-edited-source-and-repair');
 const output=after.result.groups.find(g=>g.path.id==='export').records[0].outputs[0],file=path.join(out,'workbench',after.s.task.id,'run',output),raw=await fs.readFile(file);await fs.appendFile(file,' ');assert.equal((await state()).repair.status,'unverified');await fs.writeFile(file,raw);assert.equal((await state()).repair.status,'verified-repair');checks.push('changed-download-invalidates-repair');
 assert.deepEqual(await fs.readFile(fixture),original);checks.push('original-fixture-unchanged');
 const summary={scope:'受控阅读清单独立副本，经真实工作台任务执行与关联；非陌生项目',checks,checkCount:11,repetitions:2,knownDefects:1,affectedBefore:['export','export-filter','export-refresh'],afterIssues:0,repairStatus:after.s.repair.status,criteriaHash:after.s.repair.beforeCriteriaHash,beforeProgramHash:after.s.repair.beforeProgramHash,afterProgramHash:after.s.repair.afterProgramHash,downloads,userTimeSavedMs:null,reworkSaved:null};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({checks,repair:after.s.repair,origin:demo.app.origin,project:demo.project},null,2));
 if(process.argv.includes('--inspect'))await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{await demo.close();}
