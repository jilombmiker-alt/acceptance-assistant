import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {captureRepairSource,sealRepairEvidence,repairBeforeURL,repairHTML} from './repair-evidence.mjs';
import {loadRepairHistory,repairHistoryHTML,repairHistoryUnavailable} from './repair-history.mjs';

async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'repair-history-'));
 try{
  const source=path.join(root,'source'),directory=path.join(root,'prior'),run=path.join(directory,'run');await fs.mkdir(source);await fs.mkdir(run,{recursive:true});
  await fs.writeFile(path.join(source,'index.html'),'sample');
  const plan={goal:'原标准',policy:{normalRuns:2},paths:[{id:'export'}]};
  const session={task:{id:'prior'},intake:{root:source,files:[{file:'index.html',sha256:bodyHash('sample')}]},observation:{url:'http://127.0.0.1:1'},executionPlan:plan};
  session.repairSource=await captureRepairSource(session,directory);
  const result={groups:[{path:{id:'export',name:'<script>问题</script>',trigger:'点击导出'},status:'issue',records:[{id:'export-0',status:'issue',checks:[{label:'状态',status:'issue',expected:true,actual:false}],outputs:['export.json'],snapshots:[]}]}]};
  for(const [file,data] of Object.entries({'plan.json':plan,'results.json':result,'export-0.json':{},'execution-identity.json':{authorization:'private'},'export.json':{read:false}}))await fs.writeFile(path.join(run,file),JSON.stringify(data));
  const hash=await sealRepairEvidence(session,directory,run),current={task:{id:'current'},repairBaseline:{taskId:'prior',hash}};
  await fn({root,directory,run,current,folder:id=>{assert.equal(id,'prior');return directory;}});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}

test('prior view reads sealed criteria and artifacts without requiring a mutable session',()=>fixture(async({current,folder,run})=>{
 const h=await loadRepairHistory(current,folder);assert.equal(h.plan.goal,'原标准');assert.deepEqual(await h.readFile('export.json'),await fs.readFile(path.join(run,'export.json')));
 for(const file of ['execution-identity.json','export-0.json','results.json','../session.json','/export.json','missing.json'])await assert.rejects(h.readFile(file));
 const html=repairHistoryHTML(h);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/预期：true/);assert.match(html,/实际：false/);assert.match(html,/当前任务保持不变/);assert.ok(!html.includes('<form'));assert.ok(!html.includes('/start'));
}));

test('prior artifacts are rehashed on delivery and symlinks are rejected',()=>fixture(async({current,folder,run})=>{
 const h=await loadRepairHistory(current,folder),file=path.join(run,'export.json'),original=await fs.readFile(file);
 await fs.writeFile(file,'{}');await assert.rejects(h.readFile('export.json'),/变化/);await assert.rejects(loadRepairHistory(current,folder));
 await fs.unlink(file);await fs.writeFile(path.join(run,'copy.json'),original);await fs.symlink('copy.json',file);await assert.rejects(loadRepairHistory(current,folder));
}));

test('history URL changes with current task and sealed baseline, not arbitrary request IDs',()=>fixture(async({current,folder})=>{
 const url=repairBeforeURL(current);assert.match(url,/^\/repair-before\/[a-f0-9]{64}$/);
 for(const next of [{...current,task:{id:'next'}},{...current,repairBaseline:{...current.repairBaseline,file:'repair-evidence-run-resume-00000000-0000-0000-0000-000000000001.json'}}])assert.notEqual(repairBeforeURL(next),url);
 assert.equal(repairBeforeURL(null),null);await assert.rejects(loadRepairHistory({},folder));
 assert.match(repairHTML({beforeReportURL:url}),/查看上轮问题与证据/);assert.ok(!repairHTML({beforeReportURL:url},{download:false}).includes(url));
 assert.ok(!repairHistoryUnavailable('<img src=x>').includes('<img'));
}));
