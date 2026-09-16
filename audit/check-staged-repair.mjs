import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {startReadingRepairDemo} from '../v3/reading-repair-demo.mjs';
const out=path.resolve(process.argv[2]||'runs/staged-repair-'+Date.now());await fs.mkdir(out);
const demo=await startReadingRepairDemo({directory:out}),observe=process.argv.includes('--observe'),stages=[],ids=['add','read','filter','export','export-filter'];
const token=(await(await fetch(demo.app.origin)).text()).match(/data-task-token="([^"]+)"/)[1],source=path.join(demo.project,'app.js');
const state=async()=>await(await fetch(demo.app.origin+'/state')).json();
async function post(route,data){const s=await state(),r=await fetch(demo.app.origin+route,{method:'POST',headers:{Origin:demo.app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task.id,revision:s.task.revision})})});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;}
async function run(name,expected){
 await post('/prepare',{projectPath:demo.project,url:demo.site.url+'index.html',mode:'reviewed-reading',normalRuns:2});let s=await state();s=await post('/revise',{excludedPaths:s.task.checks.filter(c=>!ids.includes(c.id)).map(c=>c.id)});
 await post('/start',{confirmed:true,digest:s.task.digest});await demo.app.wait();s=await state();const result=(await(await fetch(demo.app.origin+'/results.json')).json()).execution;
 assert.deepEqual(result.groups.map(g=>g.status),expected);const record={stage:name,taskId:s.task.id,sourceHash:bodyHash(await fs.readFile(source)),criteriaHash:bodyHash(JSON.stringify(s.task.plan)),groups:result.groups.map(g=>({id:g.path.id,status:g.status,attempts:g.records.length})),repair:s.repair,adviceKind:s.businessAdvice[0]?.kind||null,downloads:[]};
 for(const g of result.groups)for(const r of g.records)for(const file of r.outputs||[]){const bytes=Buffer.from(await(await fetch(demo.app.origin+'/evidence/'+encodeURIComponent(file))).arrayBuffer()),data=JSON.parse(bytes);assert.equal(data.books.length,2);assert.equal(data.books[1].read,false);assert.equal(data.books[0].read,name==='C-export-fixed');record.downloads.push({file,sha256:bodyHash(bytes),read:data.books.map(b=>b.read)});}
 const directory=path.join(out,name);await fs.mkdir(directory);for(const [url,file] of [['/report','report.html'],['/codex-context.md','context.md']])await fs.writeFile(path.join(directory,file),await(await fetch(demo.app.origin+url)).text());
 await fs.writeFile(path.join(directory,'state.json'),JSON.stringify(s,null,2));stages.push(record);console.log(JSON.stringify({stage:name,groups:record.groups,repair:s.repair?.status,reason:s.repair?.reason,progress:s.repair?.progress,advice:record.adviceKind}));return {s,record,directory};
}
try{
 const exportBroken=await fs.readFile(source,'utf8'),bothBroken=exportBroken.replace('books.push({title,read:false});','books.push({title,read:false});books.pop();');assert.notEqual(bothBroken,exportBroken);await fs.writeFile(source,bothBroken);
 const a=await run('A-prerequisite-fails',['issue','blocked','blocked','blocked','blocked']);assert.equal(a.s.repair,null);assert.equal(a.record.adviceKind,'prerequisite-blocked');
 await fs.writeFile(source,exportBroken);const b=await run('B-prerequisite-fixed',['pass','pass','pass','issue','issue']);assert.equal(b.s.repair.status,'unverified');assert.equal(b.record.adviceKind,'product-mismatch');assert.equal(b.s.repair.beforeTaskId,a.s.task.id);
 if(!observe){
  assert.deepEqual(b.s.repair.progress.fixed.map(x=>x.checkId),['add']);assert.deepEqual(b.s.repair.progress.newlyCheckedIssues.map(x=>x.checkId),['export','export-filter']);assert.deepEqual(b.s.repair.progress.newlyCheckedPasses.map(x=>x.checkId),['read','filter']);assert.deepEqual(b.s.repair.progress.regressions,[]);
  for(const file of ['report.html','context.md'])assert.ok((await fs.readFile(path.join(b.directory,file),'utf8')).includes(b.s.repair.progress.message));
  const baselineFile=path.join(out,'workbench',a.s.task.id,'run','results.json'),bytes=await fs.readFile(baselineFile);await fs.appendFile(baselineFile,' ');assert.equal((await state()).repair.progress,undefined);await fs.writeFile(baselineFile,bytes);assert.ok((await state()).repair.progress);
  if(process.argv.includes('--pdf')){const response=await fetch(demo.app.origin+'/report.pdf');assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');await fs.writeFile(path.join(b.directory,'report.pdf'),bytes);b.record.pdfSha256=bodyHash(bytes);}
  if(process.argv.includes('--inspect')){console.log(JSON.stringify({origin:demo.app.origin,pid:process.pid,stage:'inspect-partial-repair'}));await new Promise(resolve=>process.once('SIGUSR1',resolve));}
 }
 await fs.writeFile(source,exportBroken.replace('({title,read})=>({title,read:false})','({title,read})=>({title,read})'));
 const c=await run('C-export-fixed',['pass','pass','pass','pass','pass']);assert.equal(c.s.repair.status,'verified-repair');assert.equal(c.s.repair.beforeTaskId,b.s.task.id);assert.equal(c.record.adviceKind,null);assert.deepEqual(c.s.repair.fixed,['export','export-filter']);
 assert.equal(new Set(stages.map(s=>s.criteriaHash)).size,1);assert.equal(new Set(stages.map(s=>s.sourceHash)).size,3);assert.equal(stages.reduce((n,s)=>n+s.downloads.length,0),8);
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({scope:'同一目录、同一URL，先修新增再修导出；冻结5条路径，三个实际源码版本',observeOnly:observe,stages,userTimeSavedMs:null},null,2));
}finally{await demo.close();}
