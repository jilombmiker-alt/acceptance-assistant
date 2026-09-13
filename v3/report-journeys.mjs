import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {redactText,sensitiveTarget} from '../lib/privacy.mjs';
import {validatePlan} from '../v2/plan-validation.mjs';

const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Only native disclosure controls and explicitly linked, project-local JSON
// documents are compiled. The model cannot invent an action or URL here.
export async function resolveReportJourneys(raw,{url,root}){
 const page=new URL(url),journeys=[],gaps=[],documents=[];
 for(const item of raw.disclosures||[]){
  if(sensitiveTarget(item.summary)||sensitiveTarget(item.body))continue;
  journeys.push({id:'expand-'+bodyHash(JSON.stringify(item.summary)).slice(0,12),kind:'expand',name:'展开：'+item.label,steps:[{type:'goto',path:url},...item.openers.map(target=>({type:'click',target,description:'展开详情'}))],checks:[{type:'count',target:item.body,expected:1,label:'详情正文存在'},{type:'visible',target:item.body,expected:true,label:'展开后正文可见'}],source:item,dimension:'交互反馈'});
 }
 for(const link of (raw.documentLinks||[]).slice(0,12)){
  let destination;
  try{destination=new URL(link.href,page);if(destination.origin!==page.origin||destination.search||destination.hash||destination.username||destination.password||!destination.pathname.endsWith('.json')||sensitiveTarget(link.target))continue;
   const file=decodeURIComponent(destination.pathname).replace(/^\//,'');
   const bytes=await readReportFile(root,file,{maxBytes:256000});
   const content=bytes.toString('utf8');if(redactText(content)!==content)throw Error('文件含疑似敏感信息');
   const data=JSON.parse(content),hash=bodyHash(JSON.stringify(data));
   const id='document-'+bodyHash(JSON.stringify([link.target,destination.href,link.download])).slice(0,12);
   const steps=[{type:'goto',path:url},...link.openers.map(target=>({type:'click',target,description:'展开证据所在详情'})),link.download?{type:'download',target:link.target,documentURL:destination.href,newWindow:false,as:'evidence',description:'下载选定证据文件'}:{type:'click',target:link.target,documentURL:destination.href,newWindow:link.newWindow,description:'打开选定证据记录'}];
   journeys.push({id,kind:link.download?'download':'document',name:(link.download?'下载：':'查看：')+link.label,steps,checks:link.download?[{type:'json',artifact:'evidence',expected:data,label:'下载内容与选定证据文件一致'}]:[{type:'documentJSON',expected:data,label:'打开的记录与选定证据文件一致'}],document:{file,hash:bodyHash(bytes),valueHash:hash,url:destination.href},dimension:'数据正确性'});
   documents.push({file,hash:bodyHash(bytes)});
  }catch{gaps.push({kind:'document-unavailable',reason:'链接“'+link.label+'”的项目内证据文件无法核对，本轮不猜测文件内容'});}
 }
 return {journeys,documents,gaps};
}

export function compileReportJourneys(task,observation,{ids,source,excludedPaths=task.excludedPaths}={}){
 const next=structuredClone(task),catalog=observation.reportJourneys||[];
 const relevant=/报告|详情|展开|证据|记录|导出|下载/.test(task.goal)&&!/不检查(?:报告|详情|证据)/.test(task.goal);
 const selected=ids?catalog.filter(j=>ids.includes(j.id)):relevant?catalog:[];
 const basis=source?[source.label+' · '+source.quote]:['本次目标：'+task.goal+'；页面中已存在的详情与证据入口'];
 next.reportDocuments??=[];
 for(const j of selected){
  const id='report-'+j.id;if(next.checks.some(c=>c.id===id))continue;
  const p={id,name:j.name,location:observation.url,trigger:j.steps.map(s=>s.description||'打开选定报告').join(' → '),basis,steps:j.steps,checks:j.checks,reportRole:j.kind,...(j.document?{document:j.document}:{})};
  next.plan.paths.push(p);next.checks.push({id,module:j.name,dimension:j.kind==='expand'?1:2,expected:j.checks.map(c=>c.label).join('；'),basis,status:'planned',source:source?{kind:'personal-material',id:source.id}:{kind:'current-user'}});
  next.coverage.push({module:j.name,dimension:j.dimension,status:'planned',reason:'已对应实际操作与最终内容检查',checkIds:[id]});
  if(j.document){next.reportDocuments.push({file:j.document.file,hash:j.document.hash});const u=new URL(j.document.url);if(!next.proposedScope.requests.some(r=>r.pathPattern===escaped(u.pathname)))next.proposedScope.requests.push({id:'document-read-'+id,origin:u.origin,method:'GET',pathPattern:escaped(u.pathname),bodyHashes:[bodyHash('')]});}
  for(const s of j.steps){
   if(!['click','download'].includes(s.type))continue;
   const pagePath=new URL(observation.url).pathname;
   let a=next.proposedScope.actions.find(a=>a.type===s.type&&a.pagePath===pagePath&&JSON.stringify(a.target)===JSON.stringify(s.target));
   if(!a){a={id:'report-action-'+next.proposedScope.actions.length,type:s.type,target:s.target,pagePath,effects:[s.type==='download'?'export':'observe'],maxInvocations:0,description:s.description};next.proposedScope.actions.push(a);}
   a.maxInvocations+=next.normalRuns;
   if(s.type==='download'&&!next.proposedScope.allowedEffects.includes('export'))next.proposedScope.allowedEffects.push('export');
  }
 }
 if(selected.length)next.gaps=next.gaps.map(g=>g.kind==='semantic-coverage'?{...g,reason:'已对应本轮列出的详情和 JSON 证据路径；尚未覆盖的业务结果、其他文件类型与维度分别保留，不自动计为通过。'}:g);
 next.gaps.push(...(observation.reportGaps||[]));
 next.excludedPaths=[...new Set(excludedPaths)].filter(id=>next.checks.some(c=>c.id===id));for(const c of next.checks)if(next.excludedPaths.includes(c.id))c.status='outside-scope';next.plan.paths=next.plan.paths.filter(p=>!next.excludedPaths.includes(p.id));next.coverage=next.coverage.map(c=>c.checkIds.some(id=>next.excludedPaths.includes(id))?{...c,status:'outside-scope',reason:'用户本轮移除'}:c);
 next.reportContract={requestedResult:/查看证据|取得证据|下载(?:证据|记录)|导出(?:证据|记录)|拿到记录/.test(task.goal)&&!/不(?:需要|检查|用)?(?:查看|取得|下载|导出)(?:证据|记录)/.test(task.goal),basis:task.goal,limits:'只核对已发现的原生详情和项目内 JSON 证据；没有检查所有业务路径'};
 if(next.plan.paths.length)validatePlan(next.plan,{baseURL:observation.url});
 next.digest=bodyHash(JSON.stringify({...next,digest:undefined}));return next;
}

export function reportImpact(task,result){
 if(!result)return [];
 const groups=result.groups,active=new Set(task.plan.paths.map(p=>p.id));
 const outputs=groups.filter(g=>active.has(g.path.id)&&['document','download'].includes(g.path.reportRole));
 return groups.filter(g=>g.status==='issue'||g.findings?.length).map(g=>{
  let level=null,reason='尚无足够证据判断对本次核心目标的影响',alternativePaths=[];
  const same=outputs.filter(x=>x.path.document?.valueHash===g.path.document?.valueHash);
  if(['document','download'].includes(g.path.reportRole)){
   const alternatives=same.filter(x=>x.status==='pass'&&x.records.length>=2);
   if(alternatives.length){level=2;reason='本入口不符合要求，但另一路径已两次取得相同的证据内容';alternativePaths=alternatives.map(x=>x.path.id);}
   else if(task.reportContract?.requestedResult&&same.length&&same.every(x=>x.status==='issue')&&same.every(x=>x.evidence?.state==='reproduced')){level=1;reason='本次目标要求取得证据；已对应的同一结果路径均重复失败。未发现已验证的替代路径；结论限于本轮已覆盖范围。';}
  }else if(g.path.reportRole==='presentation'&&outputs.length&&outputs.every(x=>x.status==='pass'&&x.records.length>=2)&&g.path.steps.every(s=>s.type==='goto')){level=3;reason='证据结果路径已重复通过，但报告默认呈现不符合明确要求，增加了阅读操作负担';}
  return {pathId:g.path.id,level,label:level===1?'一级 · 本轮目标结果失败':level===2?'二级 · 功能受限':level===3?'三级 · 操作困扰':'影响待确认',reason,alternativePaths,evidenceState:g.evidence?.state||'unknown',scope:'本次已覆盖路径',goalBasis:task.goal};
 });
}
