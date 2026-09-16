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
