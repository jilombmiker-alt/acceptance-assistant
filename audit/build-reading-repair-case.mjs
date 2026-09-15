// Controlled development repair on ONE actual project directory and URL.
// No preset normal/fault endpoint switch and no claim of independent user benefit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {executePlan} from '../v2/engine.mjs';
import {startStaticProject} from '../v2/static-server.mjs';
import {compareRepairRuns} from '../v3/repair-comparison.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.argv[2]||path.join(root,'runs','reading-repair-'+Date.now()));
await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out); // refuse evidence overwrite
const project=path.join(out,'project');await fs.mkdir(project);
const write=async(file,value)=>fs.writeFile(path.join(out,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const files=['README.md','index.html','app.js','help.html'];
for(const file of files)await fs.copyFile(path.join(root,'projects/reading-list',file),path.join(project,file));
const original=await fs.readFile(path.join(project,'app.js'),'utf8');
const correct='({title,read})=>({title,read})',fault='({title,read})=>({title,read:false})';
assert.equal(original.split(correct).length,2,'review the fixture before changing it');
await fs.writeFile(path.join(project,'app.js'),original.replace(correct,fault));
const plan=JSON.parse(await fs.readFile(path.join(root,'plans/reading-list.json'),'utf8'));
plan.policy={normalRuns:2,failureExtraRetries:0,recoveryAttempts:0,actionTimeoutMs:5000};
const exportPath=plan.paths.find(p=>p.id==='export');
for(const [id,dependency,name] of [['export-filter','filter','筛选后仍导出全部书目'],['export-refresh','persist','刷新后导出当前状态'],['export-unread','unread','改回未读后导出']]){
 const p=structuredClone(exportPath);p.id=id;p.name=name;p.dependsOn=[dependency];p.trigger=name+'，下载并核对全部记录';
 if(id==='export-unread')p.checks[0].expected.books[0].read=false;
 plan.paths.push(p);
}
const criteria={version:'reading-repair-v1',scope:'受控阅读清单连续修改实验；新增三个由开发者预先明确的相关导出检查',requirement:await fs.readFile(path.join(project,'README.md'),'utf8'),plan,minimumRepeats:2,qualityGate:'原问题及全部相关路径通过，缺证据不算通过',primaryMetric:'原问题和回归路径的独立最终文件一致性',humanBenefit:'未测得'};
await write('frozen-criteria.json',criteria);
const criteriaHash=bodyHash(JSON.stringify(criteria)),projectId='controlled-reading-'+crypto.randomUUID();
const site=await startStaticProject(project);
const escape=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function authorization(phase){
 const actions=new Map(),reads=new Set(['/index.html','/app.js','/help.html']);
 const order=(id,seen=new Set())=>{if(seen.has(id))return [];seen.add(id);const p=plan.paths.find(x=>x.id===id);return [...(p.dependsOn||[]).flatMap(d=>order(d,seen)),p];};
 for(const p of plan.paths){let pagePath;for(const dependency of order(p.id))for(const step of dependency.steps){
  if(step.type==='goto'){pagePath=new URL(step.path,site.url).pathname;reads.add(pagePath);continue;}
  const key=JSON.stringify([step.type,step.target,pagePath]);
  if(!actions.has(key))actions.set(key,{id:'action-'+actions.size,type:step.type,...(step.target?{target:step.target}:{}),pagePath,effects:[step.type==='fill'?'input':step.type==='download'?'export':step.type==='reload'?'observe':'test-write'],maxInvocations:0});
  actions.get(key).maxInvocations+=2;
 }}
 return {schemaVersion:1,id:projectId+'-'+phase,project:plan.project,origin:new URL(site.url).origin,source:'用户授权持续迭代和自检；仅独立受控阅读副本、样例数据和本地导出，不修改用户项目',allowedEffects:['observe','input','test-write','export'],actions:[...actions.values()],requests:[...reads].map((p,i)=>({id:'read-'+i,method:'GET',origin:new URL(site.url).origin,pathPattern:escape(p),bodyHashes:[bodyHash('')]}))};
}
async function snapshot(phase){
 const dir=path.join(out,phase+'-source');await fs.mkdir(dir);
 const manifest=[];for(const file of files){const bytes=await fs.readFile(path.join(project,file));await fs.writeFile(path.join(dir,file),bytes,{flag:'wx'});manifest.push({file,sha256:bodyHash(bytes)});}
 return {manifest,programHash:bodyHash(JSON.stringify(manifest))};
}
try{
 const runs=[];
 for(const phase of ['before','after']){
  if(phase==='after'){
   const current=await fs.readFile(path.join(project,'app.js'),'utf8');assert.equal(current.split(fault).length,2);
   await fs.writeFile(path.join(project,'app.js'),current.replace(fault,correct));
   await write('change.json',{file:'app.js',removed:fault,added:correct,reason:'保留每条书目的实际 read 状态，不再强制写成 false',source:'本轮开发者在同一副本上实际修改',beforeProgramHash:runs[0].programHash});
  }
  const source=await snapshot(phase),executionDir=path.join(out,phase+'-execution');
  const result=await executePlan({baseURL:site.url,plan:structuredClone(plan),out:executionDir,authorization:authorization(phase),authorizationStore:path.join(out,'authorizations')});
  const evidence=[];
  for(const g of result.groups)for(const r of g.records){
   for(const file of [r.id+'.json',...r.outputs,...r.snapshots.map(s=>s.file)]){const bytes=await readReportFile(executionDir,file);evidence.push({file:phase+'-execution/'+file,sha256:bodyHash(bytes)});}
   if(g.path.steps.some(s=>s.type==='download'))assert.ok(r.outputs.length,'missing actual downloaded file');
  }
  for(const entry of source.manifest)assert.equal(bodyHash(await fs.readFile(path.join(project,entry.file))),entry.sha256,'source changed during execution');
  assert.equal(bodyHash(JSON.stringify(JSON.parse(await fs.readFile(path.join(out,'frozen-criteria.json'),'utf8')))),criteriaHash);
  const run={projectId,phase,criteriaHash,...source,evidenceVerified:true,evidence,groups:result.groups.map(g=>({pathId:g.path.id,status:g.status,records:g.records.map(r=>({id:r.id,status:r.status,checks:r.checks,outputs:r.outputs}))}))};
  await write(phase+'.json',run);runs.push(run);console.log(JSON.stringify({phase,paths:run.groups.length,issues:run.groups.filter(g=>g.status==='issue').map(g=>g.pathId)}));
 }
 const comparison=compareRepairRuns(runs[0],runs[1],plan.paths.map(p=>p.id));
 assert.equal(comparison.status,'verified-repair',JSON.stringify(comparison));
 assert.deepEqual(comparison.fixed.sort(),['export','export-filter','export-refresh']);
 const summary={schemaVersion:1,projectId,criteriaHash,scope:criteria.scope,comparison,uniqueIssue:{id:'reading-export-state',description:'导出丢失已读状态',affectedChecks:comparison.fixed},checkCount:plan.paths.length,repetitions:2,beforeProgramHash:runs[0].programHash,afterProgramHash:runs[1].programHash,files:['frozen-criteria.json','before.json','after.json','change.json'],userTimeSavedMs:null,reworkSaved:null,limitations:['受控已知问题，不是陌生项目迁移','当前为开发者运行的审计入口，尚未接入用户报告的自动修复关联','文件指纹证明本次保存一致性，不代替独立真人复核']};
 await write('summary.json',summary);console.log(JSON.stringify(summary,null,2));
 assert.equal(await fs.readFile(path.join(root,'projects/reading-list/app.js'),'utf8'),original);
}finally{await new Promise(r=>site.server.close(r));}
