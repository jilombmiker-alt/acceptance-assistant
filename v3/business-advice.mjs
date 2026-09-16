import {bodyHash} from '../lib/authorization.mjs';
const exportIds=new Set(['export','export-filter','export-refresh','export-unread']);
const shortReason=text=>String(text||'未记录').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,400);
const ownDifferences=r=>(r.checks||[]).filter(c=>c.status==='issue'&&!c.setup);
const repeatedDifference=g=>g.status==='issue'&&g.records.length>=2&&g.records.every(r=>r.status==='issue'&&ownDifferences(r).length);
const fact=g=>({checkId:g.path.id,name:g.path.name,location:g.path.location,trigger:g.path.trigger,basis:g.path.basis,records:g.records.map(r=>({file:r.id+'.json',outputs:r.outputs||[],checks:ownDifferences(r).map(c=>({label:c.label,expected:c.expected,actual:c.actual}))}))});
export function executionCounts(result){
 return result?Object.fromEntries(['pass','issue','blocked','unverified'].map(status=>[status,result.groups.filter(g=>g.status===status).length])):null;
}
function prerequisiteRoots(blocked,groups){
 const found=new Map(),byId=new Map(groups.map(g=>[g.path.id,g]));
 const visit=(g,seen)=>{
  if(!g||seen.has(g.path.id))return;seen.add(g.path.id);
  if(g.status==='blocked'){
   const ids=[...(g.path.dependsOn||[]),...g.records.map(r=>r.failedAt).filter(id=>id&&id!==g.path.id)];
   for(const id of new Set(ids)){const dependency=byId.get(id);if(dependency&&dependency.status!=='pass')visit(dependency,seen);}
  }else if(g.status!=='pass')found.set(g.path.id,g);
 };
 for(const g of blocked)visit(g,new Set());return [...found.values()];
}
export function businessAdvice({task,result,evidenceVerified=false,opinions=[]}){
 if(task?.mode!=='reviewed-reading'||!result)return [];
 const active=result.groups.filter(g=>task.plan.paths.some(p=>p.id===g.path.id));
 const groups=active.filter(g=>exportIds.has(g.path.id)&&g.status!=='pass');if(!groups.length)return [];
 const confirmed=evidenceVerified&&groups.every(g=>repeatedDifference(g)&&g.records.every(r=>r.outputs?.length));
 const id=bodyHash(task.id+':export-consistency').slice(0,16),feedback=opinions.filter(o=>o.adviceId===id),decision=feedback.at(-1)?.adviceDecision||'pending';
 let detail={kind:confirmed?'product-mismatch':'evidence-gap',title:confirmed?'先核对导出数据来源和阅读状态映射':'先补齐导出检查证据',impact:confirmed?'已覆盖的导出结果与当前阅读状态不一致，不能据此交付“导出保持当前状态”的要求。':'尚不能确认导出是否符合要求；执行不完整或证据未核对不等于产品缺陷。',facts:confirmed?groups.map(fact):[],blockers:[],
  unknown:'尚未证明具体根因，也未证明这些路径一定属于同一缺陷；不能只凭现象直接改写实现。',
  next:confirmed?'交给开发核对导出读取的记录来源及 read 字段映射，再决定修改；建议本身不修改代码。':'先核对未完成路径、控件和下载文件；补齐原始记录并重新执行，不先判定业务根因。',
  recheck:'保留原标准，复查混合已读/未读、筛选后全部导出、刷新后和改回未读后的实际 JSON；每条至少两次，缺文件或未执行不算通过。',
  change:'把导出差异、文件与原标准整理为开发交接；没有执行代码修改，也没有降低原标准。'};
 const blocked=groups.filter(g=>g.status==='blocked');
 if(evidenceVerified&&blocked.length){
  const roots=prerequisiteRoots(blocked,active),names=roots.map(g=>'「'+g.path.name+'」').join('、');
  const product=roots.length&&roots.every(repeatedDifference);
  detail={...detail,kind:'prerequisite-blocked',title:'先处理导出之前的受阻环节',
   impact:'有 '+blocked.length+' 条导出路径因前置条件未通过而受阻，尚不能判断这些导出结果；不另算为导出缺陷。',
   facts:[...roots.filter(repeatedDifference),...groups.filter(g=>repeatedDifference(g)&&g.records.every(r=>r.outputs?.length))].map(fact),
   blockers:roots.map(g=>({checkId:g.path.id,name:g.path.name,status:g.status,kind:repeatedDifference(g)?'observed-mismatch':'execution-incomplete',reason:shortReason(g.reason),location:g.path.location,trigger:g.path.trigger,records:g.records.map(r=>({file:r.id+'.json',status:r.status,reason:shortReason(r.reason)}))})),
   unknown:'受阻路径没有完整结果。前置环节的偏差或执行中断也不证明具体根因；同一个前置环节按检查项合并展示。',
   next:roots.length?(product?'先处理前置'+names+'的已观察偏差，再按原标准复查受阻路径。':'先核对前置'+names+'的控件定位、页面状态和执行记录，再重新检查受阻路径；目前不能判定导出内容有错。'):'先核对原计划的前置条件与执行记录；当前记录不足以定位最早受阻环节。',
   recheck:'先让前置路径按原标准完成核对，再复查本轮受阻的导出路径；正常或明确偏差至少两次，未完成执行不自动重放。',
   change:'沿已执行计划的依赖关系定位待处理前置环节，保留受阻路径和原始证据；没有修改代码或降低原标准。'};
 }else if(evidenceVerified&&groups.every(g=>g.status==='unverified'&&g.records.some(r=>r.status==='unverified'&&r.firstDeviation?.kind==='executor-incomplete'))){
  detail={...detail,kind:'execution-incomplete',title:'先查清导出检查为什么未完成',impact:'导出检查未完成，没有取得可用于确认导出要求的完整结果。',
   next:'先核对导出控件、下载是否实际触发及执行记录；补齐运行条件后按原标准重新检查。',
   unknown:'目前不能判断导出内容或业务根因；执行器未完成检查不直接算作产品缺陷。',
   blockers:groups.map(g=>({checkId:g.path.id,name:g.path.name,status:g.status,kind:'execution-incomplete',reason:shortReason(g.reason),location:g.path.location,trigger:g.path.trigger,records:g.records.map(r=>({file:r.id+'.json',status:r.status,reason:shortReason(r.reason)}))}))};
 }
 return [{id,...detail,affectedPaths:groups.map(g=>({checkId:g.path.id,name:g.path.name,status:g.status})),
  next:decision==='reject'?'此建议已拒绝。保留问题和证据，等待新的排查方向。':decision==='correct'?'已收到纠正。先核对下方用户记录，再决定排查方向。':detail.next,
  decision,feedback,effectStatus:'unmeasured',userTimeSavedMs:null}];
}
export function businessAdviceHTML(advice=[],history=[]){
 if(!advice.length&&!history.length)return '';
 const decision=x=>({pending:'待选择',accept:'已采纳，效果待验证',reject:'已拒绝',correct:'已纠正，待核对'})[x]||x;
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<section id="business-advice"><h2>下一步怎么处理</h2>'+advice.map(a=>'<p><strong>'+e(a.title)+'</strong> · '+e(a.next)+'</p><details><summary>查看影响、证据与复查条件</summary><p>'+e(a.impact)+'</p><p>'+e(a.unknown)+'</p><p>'+e(a.change)+'</p><p>复查条件：'+e(a.recheck)+'</p>'+(a.blockers||[]).map(b=>'<div class="advice-record"><p><strong>待处理环节：'+e(b.name)+'</strong> · '+e(b.kind==='observed-mismatch'?'已观察偏差':'执行未完成')+'</p><p>位置：'+e(b.location)+'；触发：'+e(b.trigger)+'</p><p>'+e(b.reason)+'</p><p>操作记录：'+e(b.records.map(r=>r.file).join('、')||'未取得')+'</p></div>').join('')+a.facts.map(f=>'<p>'+e(f.name)+'；位置：'+e(f.location)+'；触发：'+e(f.trigger)+'；依据：'+e((f.basis||[]).join('、'))+'</p>'+f.records.map(r=>'<div class="advice-record"><p>操作记录：'+e(r.file)+'；产物：'+e((r.outputs||[]).join('、'))+'</p>'+r.checks.map(c=>'<p>'+e(c.label)+'<br>预期：'+e(JSON.stringify(c.expected))+'<br>实际：'+e(JSON.stringify(c.actual))+'</p>').join('')+'</div>').join('')).join('')+'<p>当前选择：'+e(decision(a.decision))+'。采纳不等于有效，人工省时未测得。</p>'+a.feedback.map(o=>'<p>用户记录（待核对）：'+e(o.text)+'</p>').join('')+'</details>').join('')+(history.length?'<details><summary>查看此前建议反馈（不自动沿用）</summary>'+history.map(o=>'<p>'+e(decision(o.adviceDecision))+'：'+e(o.text)+'</p>').join('')+'</details>':'')+'</section>';
}
