import {reportStyle} from './report-style.mjs';

export function reportShell({data,evaluation,controlled,issues,coverage,e}) {
 const groups=data.cases.flatMap(c=>c.result.groups);
 const count=status=>groups.filter(g=>g.status===status).length;
 const findings=groups.reduce((n,g)=>n+(g.findings?.length||(g.status==='issue'?1:0)),0);
 const remaining=count('blocked')+count('unverified');
 const headline=findings?'问题已定位，先处理关键偏差':remaining?'部分路径仍待验证':evaluation.pass?'本轮检查项符合预期':'已执行路径完成，覆盖仍有缺项';
 const next=findings?'先核对下方问题与实际产物，修复后按原条件重复验证。':remaining?'先补齐受阻路径所需条件，再接回未完成的验证。':evaluation.pass?'保留本轮证据；后续修改可沿用已确认条件进行复验。':'查看目标与覆盖，确定缺项是否属于本次目标，再安排后续验证。';
 const date=new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const scope=controlled?'受控案例 · 故障由测试样例人为设置，不代表真实用户项目的问题。':'项目实测 · 结论仅适用于本次计划与实际取得的证据。';
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(data.title||'产品验收报告')}</title><style>${reportStyle}</style></head><body><main>
 <div class="masthead"><div class="brand"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="3" y="3" width="22" height="22" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="m8 14 4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>验收助手</div><span class="muted">让每一次迭代，有据可查。</span><a href="#report-evidence">查看证据索引</a></div>
 <header class="hero"><div><h1>${e(data.title||'产品验收报告')}</h1><p class="hero-description">${e(data.description||data.cases.map(c=>c.result.goal).filter(Boolean).join('；'))}</p><p class="purpose">按目标检查流程 · 对照实际结果 · 集中呈现问题与证据</p><p class="note">${e(date)} · 北京时间</p></div><div class="verdict"><span class="tag ${findings?'issue':remaining||!evaluation.pass?'unverified':'pass'}">${findings?'发现问题':remaining||!evaluation.pass?'未完成整体验证':'本轮符合预期'}</span><h2>${headline}</h2><p class="note">${count('pass')} 条路径符合预期，${count('issue')} 条发现问题${remaining?'，'+remaining+' 条受阻或未验证':''}。范围外的功能不计入通过。</p><div class="stats"><div class="stat"><strong>${data.cases.length}</strong><span>执行任务</span></div><div class="stat"><strong>${groups.reduce((n,g)=>n+g.records.length,0)}</strong><span>路径执行</span></div><div class="stat"><strong>${findings}</strong><span>问题记录</span></div></div></div></header>
 <nav class="report-nav" aria-label="报告章节"><a href="#report-issues">问题与差异</a><a href="#report-coverage">检查与覆盖</a><a href="#report-boundary">结论边界</a></nav><p class="context-note">${scope} 准备步骤保留在操作记录中，不重复计入主路径次数。</p>
 <section id="report-issues" class="report-section"><h2>发现的问题</h2><p class="section-intro">把发生位置、预期与实际放在一起，帮助确定下一步修改。</p>${issues||'<div class="empty-result">本轮未发现确定问题。<p>这不代表整个产品通过，未完成部分见下方覆盖记录。</p></div>'}</section>
 <div class="next-step"><div><b>下一步建议</b><p>${next}</p></div><a href="${findings?'#report-issues':'#report-coverage'}">${findings?'核对问题与证据':'查看检查范围'}</a></div>
 <section id="report-coverage" class="report-section"><h2>路径覆盖</h2><p class="section-intro">展开查看每条路径的结果、依据和重复验证记录。</p>${coverage}</section>
 <div id="report-boundary" class="boundary"><b>这份报告能说明什么</b><div><p>${data.coverageOnly?'本轮覆盖核对':controlled?'样例答案对照':'本轮路径核对'}：${evaluation.pass?'本组符合预期':'存在偏差或未验证项'}。</p><p>${controlled?'本轮使用已审核的检查计划，记录真实执行与最终结果。受控案例可验证执行和核对能力，不能证明任意项目的自动规划或通用语义判断能力。':'本轮按已确认计划执行；受阻、范围外或未验证部分不能计为整个产品通过。暂停、继续及进程恢复的记录也不替代业务结果验证。'}</p></div></div>
 <footer id="report-evidence"><div class="links"><a href="results.json">原始结果</a><a href="evaluation.json">${controlled&&!data.coverageOnly?'答案对照':'覆盖核对记录'}</a>${data.title?'':'<a href="intake-reading.json">阅读清单材料证据</a><a href="intake-expense.json">费用项目材料证据</a>'}</div><p>验收助手 · 依据、执行、结果，可追溯。</p></footer>
 </main></body></html>`;
}
