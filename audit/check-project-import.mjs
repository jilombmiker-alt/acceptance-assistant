import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acceptance-intake-'));
const app=await startWorkbench({allowedRoot:dir,stateDir:path.join(dir,'state')});
try{
 const html=await(await fetch(app.origin+'/connect')).text(),token=html.match(/data-task-token="([a-f0-9]+)"/)[1];
 const post=async(route,data,status=200)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
 const unauthorized=await fetch(app.origin+'/import-project',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unauthorized.status,403);
 const records=[];
 for(const corrected of [false,true]){
  // An independent supplied project; no built-in demo mode or reading-list selectors.
  const source='<title>Import acceptance sample</title><h1>'+(corrected?'Ready':'Draft')+'</h1><label>Name<input id="name"></label>';
  const project=await post('/import-project',{files:[{path:'index.html',data:Buffer.from(source).toString('base64')}]});
  let state=await post('/prepare',{...project,mode:'basic',goal:'检查输入框和手机适配',expectedText:'Ready',normalRuns:2});
  assert.deepEqual(state.task.checks.map(c=>c.id),['entry','expected-text','input-0','layout']);
  state=await post('/start',{taskId:state.task.id,revision:state.task.revision,digest:state.task.digest,confirmed:true});
  await app.wait();
  const result=await(await fetch(app.origin+'/results.json')).json();
  assert.equal(result.execution.groups.filter(g=>g.status==='issue').length,corrected?0:1);
  assert.ok(result.execution.groups.every(g=>g.records.length===2));
  assert.equal((await fetch(app.origin+'/report')).status,200);
  records.push({version:corrected?'corrected':'before',checks:result.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length}))});
 }
 console.log(JSON.stringify({scope:'Local uploaded static webpage only; same goal and expected text, four checks twice per version',records},null,2));
}finally{await app.end();await app.close();await fs.rm(dir,{recursive:true,force:true});}
