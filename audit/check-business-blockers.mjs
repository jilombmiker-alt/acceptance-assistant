import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {startReadingRepairDemo} from '../v3/reading-repair-demo.mjs';
const out=path.resolve(process.argv[2]||'runs/business-blockers-'+Date.now());await fs.mkdir(out);
const observe=process.argv.includes('--observe'),cases=[],paths=['add','read','filter','export','export-filter'];
const mutations={
 'add-mismatch':s=>s.replace('books.push({title,read:false});','books.push({title,read:false});books.pop();'),
 'read-control-missing':s=>s.replace("button.setAttribute('aria-label',button.textContent+' '+book.title)","button.setAttribute('aria-label','阅读状态 '+book.title)"),
 'download-missing':s=>s.replace('a.click();','/* no download dispatched */'),
 'export-mismatch':s=>s.replace('({title,read})=>({title,read})','({title,read})=>({title,read:false})'),
};
for(const [name,mutate] of Object.entries(mutations)){
 const directory=path.join(out,name),demo=await startReadingRepairDemo({directory});
 try{
  const token=(await(await fetch(demo.app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];
  const state=async()=>await(await fetch(demo.app.origin+'/state')).json();
  async function post(route,data){const s=await state(),r=await fetch(demo.app.origin+route,{method:'POST',headers:{Origin:demo.app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task.id,revision:s.task.revision})})});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;}
  const file=path.join(demo.project,'app.js'),normal=(await fs.readFile(file,'utf8')).replace('({title,read})=>({title,read:false})','({title,read})=>({title,read})');
  const altered=mutate(normal);assert.notEqual(altered,normal);await fs.writeFile(file,altered);
  await post('/prepare',{projectPath:demo.project,url:demo.site.url+'index.html',mode:'reviewed-reading',normalRuns:2});
  let s=await state();s=await post('/revise',{excludedPaths:s.task.checks.filter(c=>!paths.includes(c.id)).map(c=>c.id)});await post('/start',{confirmed:true,digest:s.task.digest});await demo.app.wait();s=await state();
  const r=await(await fetch(demo.app.origin+'/results.json')).json(),groups=r.execution.groups.map(g=>({id:g.path.id,status:g.status,attempts:g.records.length}));
  const expected={
   'add-mismatch':{add:'issue',read:'blocked',filter:'blocked',export:'blocked','export-filter':'blocked'},
   'read-control-missing':{add:'pass',read:'unverified',filter:'blocked',export:'blocked','export-filter':'blocked'},
   'download-missing':{add:'pass',read:'pass',filter:'pass',export:'unverified','export-filter':'unverified'},
   'export-mismatch':{add:'pass',read:'pass',filter:'pass',export:'issue','export-filter':'issue'},
  }[name];assert.deepEqual(Object.fromEntries(groups.map(g=>[g.id,g.status])),expected);
  const record={name,groups,advice:s.businessAdvice,impacts:s.impacts.map(i=>i.pathId),executionCounts:s.executionCounts||null,userTimeSavedMs:null};
  await fs.writeFile(path.join(directory,'observed.json'),JSON.stringify(record,null,2));
  for(const [route,file] of [['/report','report.html'],['/codex-context.md','context.md']])await fs.writeFile(path.join(directory,file),await(await fetch(demo.app.origin+route)).text());
  if(!observe){
   const a=s.businessAdvice[0],kind={'add-mismatch':'prerequisite-blocked','read-control-missing':'prerequisite-blocked','download-missing':'execution-incomplete','export-mismatch':'product-mismatch'}[name];assert.equal(a.kind,kind);assert.equal(a.userTimeSavedMs,null);
   if(kind==='prerequisite-blocked'){assert.equal(a.blockers.length,1);assert.equal(a.blockers[0].checkId,name==='add-mismatch'?'add':'read');assert.match(a.next,name==='add-mismatch'?/新增书目/:/标记已读/);assert.equal(a.facts.some(f=>f.checkId.startsWith('export')),false);}
   if(kind==='execution-incomplete'){assert.match(a.next,/下载/);assert.equal(a.facts.length,0);}
   if(kind==='product-mismatch')assert.equal(a.facts.length,2);
   assert.deepEqual(s.executionCounts,Object.fromEntries(['pass','issue','blocked','unverified'].map(status=>[status,groups.filter(g=>g.status===status).length])));
   for(const file of ['report.html','context.md'])assert.ok((await fs.readFile(path.join(directory,file),'utf8')).includes(a.next));
   if(kind==='prerequisite-blocked'){
    const evidenceFile=path.join(directory,'workbench',s.task.id,'run',a.blockers[0].records[0].file),original=await fs.readFile(evidenceFile);await fs.appendFile(evidenceFile,' ');
    const missing=(await state()).businessAdvice[0];assert.equal(missing.kind,'evidence-gap');assert.deepEqual(missing.blockers,[]);assert.deepEqual(missing.facts,[]);await fs.writeFile(evidenceFile,original);
    record.tamperedEvidenceWithholdsDiagnosis=true;
    if(process.argv.includes('--pdf')){
     const response=await fetch(demo.app.origin+'/report.pdf');assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');record.pdf={file:'report.pdf',sha256:bodyHash(bytes),visualReview:'pending'};await fs.writeFile(path.join(directory,'report.pdf'),bytes);
    }
   }
   if(name==='read-control-missing'&&process.argv.includes('--inspect')){console.log(JSON.stringify({origin:demo.app.origin,stage:'inspect-blocker-guidance',pid:process.pid}));await new Promise(resolve=>process.once('SIGUSR1',resolve));}
  }
  cases.push(record);console.log(JSON.stringify({name,groups,adviceKind:s.businessAdvice[0]?.kind,next:s.businessAdvice[0]?.next}));
 }finally{await demo.close();}
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({scope:'受控阅读清单5条路径；正常/已观察偏差各两次，执行不完整停止重放，依赖受阻不执行',observeOnly:observe,cases,userTimeSavedMs:null},null,2));
