import {redactText} from '../lib/privacy.mjs';
// Explain the existing executable plan; never infer or authorize business actions.
export function scopeGuide(task){
 if(!task||task.mode==='reviewed-reading')return null;
 const active=new Set((task.plan?.paths||[]).map(p=>p.id));
 const checks=(task.checks||[]).filter(c=>active.has(c.id));
 const modules=new Set((task.checks||[]).map(c=>c.module));
 const uncovered=[...new Set((task.coverage||[]).filter(r=>r.status==='unsupported'&&!r.checkIds.length&&!modules.has(r.module)).map(r=>r.module))];
 const excluded=[...new Set((task.coverage||[]).filter(r=>r.status==='outside-scope').map(r=>r.module))];
 const warnings=[...new Set((task.gaps||[]).filter(g=>['mapping','observation','document-unavailable','endpoint'].includes(g.kind)).map(g=>g.reason))];
 return {kind:'basic',checks:checks.map(c=>({id:c.id,name:c.module})),uncovered,excluded,warnings,
  boundary:'仅验证列出的网页检查，目标中的其他业务流程尚未验证。',
  next:checks.length?'先完成这些检查；要验收完整业务，还需要把操作、预期结果和验证方式对应起来。':'本轮没有可执行检查。请调整检查范围后重新生成计划。'};
}

const observationLabels={intake:'扫描范围',observation:'未读取请求',mapping:'输入定位观察','document-unavailable':'证据文件读取'};
export function observationNotes(task){
 const seen=new Set(),all=[];
 for(const g of task?.gaps||[]){
  if(!Object.hasOwn(observationLabels,g.kind)||typeof g.reason!=='string'||!g.reason.trim())continue;
  const reason=redactText(g.reason),key=g.kind+'\n'+reason;if(seen.has(key))continue;seen.add(key);
  all.push({kind:g.kind,label:observationLabels[g.kind],reason:reason.length>600?reason.slice(0,600)+'…（完整说明见当前计划）':reason});
 }
 return {scope:'来自本计划生成时的文件扫描与页面观察；不是业务失败判定，不授予新的读取或操作权限。新版本需重新生成计划。',items:all.slice(0,12),omitted:Math.max(0,all.length-12),empty:'本计划未记录此类接入缺项，不代表所有依赖均已检查。'};
}
export function observationNotesHTML(task){
 const n=observationNotes(task),e=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<section id="intake-observation"><h2>本计划的接入观察</h2><p>'+e(n.scope)+'</p>'+(n.items.length?'<ul>'+n.items.map(g=>'<li>'+e(g.label)+'：'+e(g.reason)+'</li>').join('')+'</ul>':'<p>'+e(n.empty)+'</p>')+(n.omitted?'<p>另有 '+n.omitted+' 条接入说明，完整内容见当前计划。</p>':'')+'</section>';
}
