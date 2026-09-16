import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bodyHash,validateAuthorization} from '../lib/authorization.mjs';
import {sanitize} from '../lib/privacy.mjs';
import {validatePlan} from '../v2/plan-validation.mjs';
import {dimensions} from './planner.mjs';
import {localURL} from './discover.mjs';

const base=fileURLToPath(new URL('../',import.meta.url));
export const businessMode='reviewed-reading';
export const businessLimits='已审核阅读清单业务计划：新增、状态、筛选、刷新与导出；由助手分析材料后编写，不是通用 AI 自动规划。仅在独立测试浏览器中操作样例数据。';
const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// The catalog is server-owned. Never derive permission to arbitrary UI actions
// from an uploaded/model-generated plan. A task still needs its own start receipt.
export async function compileBusinessTask({id,revision=1,intake,observation,normalRuns=2,excludedPaths=[],reviewedRoot,exportRegressions=false}){
 if(![2,3].includes(normalRuns))throw Error('本轮业务计划支持 2 或 3 次验证');
 const sourceRoot=await fs.realpath(reviewedRoot||path.join(base,'projects/reading-list'));
 if(await fs.realpath(intake.root)!==sourceRoot)throw Error('此业务计划只适用于已审核阅读清单项目；不能套用到 Handy 或其他项目');
 // reviewedRoot and exportRegressions are trusted launcher settings, never HTTP fields.
 const template=JSON.parse(await fs.readFile(path.join(base,'plans/reading-list.json'),'utf8'));
 if(exportRegressions){
  for(const [id,dependency,name] of [['export-filter','filter','筛选后仍导出全部书目'],['export-refresh','persist','刷新后导出当前状态'],['export-unread','unread','改回未读后导出']]){
   const check=structuredClone(template.paths.find(p=>p.id==='export'));Object.assign(check,{id,name,dependsOn:[dependency],trigger:name+'，下载并核对全部记录'});
   if(id==='export-unread')check.checks[0].expected.books[0].read=false;
   template.paths.push(check);
  }
 }
 for(const file of ['README.md','index.html','app.js','help.html']){
  const row=intake.files.find(x=>x.file===file);
  if(!row||row.sha256!==bodyHash(await fs.readFile(path.join(sourceRoot,file))))throw Error('业务计划材料不完整或已变化，请重新读取');
 }
 if(!Array.isArray(excludedPaths)||excludedPaths.some(x=>!template.paths.some(p=>p.id===x)))throw Error('移除的业务路径不属于本计划');
 const url=localURL(observation.url),directory=new URL('./',url);
 if(!url.pathname.endsWith('/index.html'))throw Error('已审核案例需要明确的 index.html 页面入口');
 const excluded=new Set(excludedPaths);
 // Removing a prerequisite also removes all paths that would replay it as setup.
 let changed=true;while(changed){changed=false;for(const p of template.paths)if(!excluded.has(p.id)&&(p.dependsOn||[]).some(d=>excluded.has(d))){excluded.add(p.id);changed=true;}}
 const all=structuredClone(template.paths);
 const materialRefs=[];
 for(const p of all){
  for(const ref of p.basis){const match=ref.match(/^(.+):(\d+)$/),f=match&&intake.files.find(x=>x.file===match[1]);if(!f)throw Error('业务依据不在已扫描资料：'+ref);const text=(await fs.readFile(path.join(sourceRoot,match[1]),'utf8')).split('\n')[Number(match[2])-1];if(!text?.trim())throw Error('业务依据行不存在：'+ref);materialRefs.push({file:match[1],line:Number(match[2]),excerpt:text});}
  for(const s of p.steps)if(s.type==='goto')s.path=new URL(s.path,directory).href;
 }
 const plan={...template,policy:{normalRuns,failureExtraRetries:0,recoveryAttempts:1,actionTimeoutMs:2500},paths:all.filter(p=>!excluded.has(p.id))};
 if(plan.paths.length)validatePlan(plan,{baseURL:url.href});
 const actions=[],reads=new Set([url.pathname,new URL('app.js',directory).pathname]),counts=new Map();
 const ordered=(id,seen=new Set())=>{if(seen.has(id))return [];seen.add(id);const p=plan.paths.find(x=>x.id===id);return [...(p.dependsOn||[]).flatMap(d=>ordered(d,seen)),p];};
 for(const target of plan.paths){let pagePath;
  for(const p of ordered(target.id))for(const s of p.steps){
   if(s.type==='goto'){pagePath=new URL(s.path).pathname;reads.add(pagePath);continue;}
   if(!['fill','click','select','reload','download'].includes(s.type))throw Error('本审核模板包含未说明的动作');
   const key=JSON.stringify([s.type,s.target,pagePath]);
   if(!counts.has(key)){
    const effect=s.type==='fill'?'input':s.type==='download'?'export':s.type==='reload'?'observe':'test-write';
    const action={id:'reviewed-'+actions.length,type:s.type,...(s.target?{target:s.target}:{}),pagePath,effects:[effect],maxInvocations:0,description:s.type+' · '+(s.target?.name||s.target?.label||s.target?.css||pagePath)};
    counts.set(key,action);actions.push(action);
   }
   counts.get(key).maxInvocations+=normalRuns;
  }
 }
 const proposedScope={schemaVersion:1,id,project:plan.project,origin:url.origin,source:'已审核受控业务动作候选；待用户在当前版本页面开始，模板不等于授权',allowedEffects:['observe','input','test-write','export'],actions,requests:[...reads].map((p,i)=>({id:'business-read-'+i,method:'GET',origin:url.origin,pathPattern:esc(p),bodyHashes:[bodyHash('')]}))};
 validateAuthorization(proposedScope,url.href,plan.project);
 const checks=all.map(p=>({id:p.id,module:p.name,dimension:2,basis:p.basis,expected:p.checks.map(c=>c.label+'：'+JSON.stringify(c.expected)).join('；'),status:excluded.has(p.id)?'outside-scope':'planned'}));
 const coverage=checks.flatMap(c=>dimensions.map((dimension,i)=>({module:c.module,dimension,status:excluded.has(c.id)?'outside-scope':[0,2].includes(i)?'planned':'unsupported',reason:excluded.has(c.id)?'本次移除，或前置路径已移除，不执行依赖准备动作':[0,2].includes(i)?c.expected:'本业务计划没有此维度的完整检查，不计通过',checkIds:[0,2].includes(i)?[c.id]:[]})));
 const task={id,revision,mode:businessMode,goal:template.goal,endpoint:'完成本次保留的业务路径及结果核对后结束',expectedText:'',normalRuns,fieldValues:{},excludedPaths:[...excluded],sources:{current:{kind:'reviewed-plan',text:template.goal,revision},materials:materialRefs,historyPolicy:'仅采用此版本明确资料；历史偏好不自动生效'},fingerprint:intake.fingerprint,fingerprintScope:intake.fingerprintScope,templateHash:bodyHash(JSON.stringify(template)),checks,coverage,gaps:[{kind:'scope',reason:'这是受控样例与已审核计划，不能证明任意项目自动理解；未支持维度保留。'}],plan,proposedScope,limitations:businessLimits};
 task.digest=bodyHash(JSON.stringify(task));return sanitize(task);
}
