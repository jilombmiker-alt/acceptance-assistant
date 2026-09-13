import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {bodyHash} from '../lib/authorization.mjs';
import {startWorkbench} from '../v3/workbench.mjs';
import {startStaticProject} from '../v2/static-server.mjs';
const root=path.resolve('.'),out=path.join(root,'runs','repair-case-'+new Date().toISOString().replace(/[:.]/g,'-')),project=path.join(out,'project');
await fs.mkdir(project,{recursive:true});
const source=await fs.readFile(path.join(root,'projects/report-feedback/expanded.html'),'utf8'),documentBytes=await fs.readFile(path.join(root,'projects/report-feedback/record.json'));
const correction='报告详情正文默认收起，需要时再展开；证据仍需能打开和下载。';
await fs.writeFile(path.join(project,'index.html'),source);await fs.writeFile(path.join(project,'record.json'),documentBytes);await fs.writeFile(path.join(project,'纠正.md'),correction);
const site=await startStaticProject(project),provider={available:true,name:'固定已确认要求，非模型收益对照',async run(input){const m=input.materials.find(m=>m.label==='纠正.md'),t=input.observedTargets.find(t=>t.target.css==='#detail-body');assert.ok(m&&t);return {value:{items:[{sourceId:m.id,quote:correction,kind:'requirement',summary:'报告详情默认收起',scope:'当前报告的首次打开状态',decision:'apply',reason:'受控案例固定要求，两版本使用相同验收标准',handoff:'',question:'',journeyIds:[],checks:[{targetId:t.id,type:'visible',expectedBoolean:false,expectedCount:0,expectedText:'',label:'详细正文默认隐藏'}]}],noExperienceReason:''},call:{provider:'fixed-rubric',calls:0}};}};
let app;
try{
 app=await startWorkbench({allowedRoot:root,stateDir:path.join(out,'state'),semanticProvider:provider});
 const token=(await(await fetch(app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];
 async function api(route,data){const s=await(await fetch(app.origin+'/state')).json();const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task.id,revision:s.task.revision})})});const value=await r.json();assert.equal(r.status,200,value.error);return value;}
 const parts=[];
 for(const phase of ['before','after']){
  const html=phase==='before'?source:source.replace('<details open>','<details>');assert.ok(phase==='before'||html!==source);await fs.writeFile(path.join(project,'index.html'),html);
  const t=await api('/prepare',{projectPath:project,url:site.url,goal:'报告详细正文默认收起，展开后能够查看和下载同一份证据。',normalRuns:2,automatic:true,materialFiles:['纠正.md']});
  const started=Date.now();await api('/start',{confirmed:true,digest:t.task.digest});await app.wait();const elapsedMs=Date.now()-started,r=await(await fetch(app.origin+'/results.json')).json();
  assert.ok(r.execution.groups.every(g=>g.records.length===2));assert.ok(r.execution.groups.every(g=>['pass','issue'].includes(g.status)));
  const part={phase,sourceHash:bodyHash(html),sourceHTML:html,taskId:t.task.id,elapsedMs,issues:r.execution.groups.filter(g=>g.status==='issue').length,checks:r.execution.groups.map(g=>({id:g.path.id,name:g.path.name,status:g.status,records:g.records.map(r=>({id:r.id,status:r.status,checks:r.checks,outputs:r.outputs}))})),description:phase==='before'?'打开报告就展开详情，不符合明确呈现要求。':'详情默认收起；展开、查看与下载证据仍然通过。'};
  parts.push(part);await fs.writeFile(path.join(out,phase+'.json'),JSON.stringify({task:t.task,result:r,elapsedMs},null,2));
 }
 const [before,after]=parts;assert.equal(before.issues,1);assert.equal(after.issues,0);assert.deepEqual(before.checks.map(c=>[c.id,c.name]),after.checks.map(c=>[c.id,c.name]));
 const summary={version:1,title:'报告详情默认展开，修复后重新验收',scope:'受控修复验证，不是个人历史 A/B，不是真人效率实验',flow:'用户打开报告 → 详情直接铺开 → 不符合先看问题的要求 → 移除默认展开 → 按原要求复检',change:'仅移除 details 的 open 属性，保留报告内容及证据链接。',criteria:before.checks.map(c=>({id:c.id,name:c.name})),repetitions:2,before,after,result:'确认修复 1 项呈现偏差，未出现已覆盖路径回归。',userTimeSavedMs:null,economicLossSaved:null,evidenceDocument:{sha256:bodyHash(documentBytes),content:JSON.parse(documentBytes)},artifactDirectory:path.relative(root,out)};
 await fs.mkdir(path.join(root,'evaluation'),{recursive:true});await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));await fs.writeFile(path.join(root,'evaluation/report-repair-case.json'),JSON.stringify(summary,null,2));
 // Original fault fixture remains unchanged for later demonstrations.
 assert.equal(await fs.readFile(path.join(root,'projects/report-feedback/expanded.html'),'utf8'),source);
 console.log(JSON.stringify({out,criteria:summary.criteria.length,beforeIssues:before.issues,afterIssues:after.issues,beforeMs:before.elapsedMs,afterMs:after.elapsedMs},null,2));
}finally{if(app){await app.wait().catch(()=>{});await app.close();}await new Promise(r=>site.server.close(r));}
