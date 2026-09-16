import {bodyHash} from '../lib/authorization.mjs';
const exportIds=new Set(['export','export-filter','export-refresh','export-unread']);
export function businessAdvice({task,result,evidenceVerified=false,opinions=[]}){
 if(task?.mode!=='reviewed-reading'||!result)return [];
 const groups=result.groups.filter(g=>exportIds.has(g.path.id)&&task.plan.paths.some(p=>p.id===g.path.id)&&g.status!=='pass');if(!groups.length)return [];
 const confirmed=evidenceVerified&&groups.every(g=>g.status==='issue'&&g.records.length>=2&&g.records.every(r=>r.status==='issue'&&r.outputs?.length&&r.checks.some(c=>c.status==='issue'&&!c.setup)));
 const id=bodyHash(task.id+':export-consistency').slice(0,16),feedback=opinions.filter(o=>o.adviceId===id),decision=feedback.at(-1)?.adviceDecision||'pending';
 return [{id,kind:confirmed?'product-mismatch':'evidence-gap',title:confirmed?'先核对导出数据来源和阅读状态映射':'先补齐导出检查证据',impact:confirmed?'已覆盖的导出结果与当前阅读状态不一致，不能据此交付“导出保持当前状态”的要求。':'尚不能确认导出是否符合要求；执行不完整或证据未核对不等于产品缺陷。',
  facts:confirmed?groups.map(g=>({checkId:g.path.id,name:g.path.name,location:g.path.location,trigger:g.path.trigger,basis:g.path.basis,records:g.records.map(r=>({file:r.id+'.json',outputs:r.outputs,checks:r.checks.filter(c=>c.status==='issue'&&!c.setup).map(c=>({label:c.label,expected:c.expected,actual:c.actual}))}))})):[],
  unknown:'尚未证明具体根因，也未证明这些路径一定属于同一缺陷；不能只凭现象直接改写实现。',
  next:decision==='reject'?'此建议已拒绝。保留问题和证据，等待新的排查方向。':decision==='correct'?'已收到纠正。先核对下方用户记录，再决定排查方向。':confirmed?'交给开发核对导出读取的记录来源及 read 字段映射，再决定修改；建议本身不修改代码。':'先核对未完成路径、控件和下载文件；补齐原始记录并重新执行，不先判定业务根因。',
  recheck:'保留原标准，复查混合已读/未读、筛选后全部导出、刷新后和改回未读后的实际 JSON；每条至少两次，缺文件或未执行不算通过。',
  change:'把导出差异、文件与原标准整理为开发交接；没有执行代码修改，也没有降低原标准。',decision,feedback,effectStatus:'unmeasured',userTimeSavedMs:null}];
}
export function businessAdviceHTML(advice=[],history=[]){
 if(!advice.length&&!history.length)return '';
 const decision=x=>({pending:'待选择',accept:'已采纳，效果待验证',reject:'已拒绝',correct:'已纠正，待核对'})[x]||x;
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<section id="business-advice"><h2>下一步怎么处理</h2>'+advice.map(a=>'<p><strong>'+e(a.title)+'</strong> · '+e(a.next)+'</p><details><summary>查看影响、证据与复查条件</summary><p>'+e(a.impact)+'</p><p>'+e(a.unknown)+'</p><p>'+e(a.change)+'</p><p>复查条件：'+e(a.recheck)+'</p>'+a.facts.map(f=>'<p>'+e(f.name)+'；位置：'+e(f.location)+'；触发：'+e(f.trigger)+'；依据：'+e((f.basis||[]).join('、'))+'</p><p style="overflow-wrap:anywhere">'+e(JSON.stringify(f.records))+'</p>').join('')+'<p>当前选择：'+e(decision(a.decision))+'。采纳不等于有效，人工省时未测得。</p>'+a.feedback.map(o=>'<p>用户记录（待核对）：'+e(o.text)+'</p>').join('')+'</details>').join('')+(history.length?'<details><summary>查看此前建议反馈（不自动沿用）</summary>'+history.map(o=>'<p>'+e(decision(o.adviceDecision))+'：'+e(o.text)+'</p>').join('')+'</details>':'')+'</section>';
}
