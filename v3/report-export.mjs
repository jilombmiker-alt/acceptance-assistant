import {observationNotesHTML} from './scope-guide.mjs';
import {businessAdviceHTML} from './business-advice.mjs';
import {repairHTML} from './repair-evidence.mjs';
import {browserEngine} from '../lib/browser.mjs';
import {helpEvaluationHTML} from './help-evaluation.mjs';
import {bodyHash} from '../lib/authorization.mjs';

export function pdfSummaryHTML({task,result,automatic,impacts,coverage,helpEvaluation,repair=null,businessAdvice=[],adviceFeedbackHistory=[]}){
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const value=x=>{const s=typeof x==='string'?x:JSON.stringify(x);return s?.length>500?s.slice(0,500)+'…（完整内容见对应操作记录）':s;};
 const evidenceWarning=businessAdvice.some(a=>a.kind==='evidence-gap')?'<p><strong>当前证据不完整：下方执行记录是历史结果，不能据此确认当前业务结论。请补齐证据后重新验收。</strong></p>':'';
 const status={pass:'本项符合预期',issue:'发现偏差',blocked:'前置受阻',unverified:'未验证'};
 const issues=result.groups.filter(g=>g.status==='issue'||g.findings?.length);
 const issueHTML=issues.map(g=>{const i=impacts.find(i=>i.pathId===g.path.id);return '<article><h3>'+e(i?.label||'影响待确认')+'</h3><p><b>问题：</b>'+e(g.path.name)+' - '+e(g.reason)+'</p><p><b>位置：</b>'+e(g.path.location)+'</p><p><b>触发操作：</b>'+e(g.path.trigger)+'</p><p>'+e(i?.reason||'尚无足够影响证据')+'</p></article>';}).join('');
 const help=(automatic?.decisions||[]).map(d=>'<article><h3>'+e(d.summary)+'</h3><p>'+e(d.change)+'；'+e(({'requirement-met':'本项符合要求','requirement-not-met':'本项不符合要求','not-run':'未执行','handoff-only':'待交接','not-applied':'未增加执行动作','outside-scope':'本轮范围外',unverified:'未验证'})[d.outcome]||d.outcome)+'</p><p>依据：'+e(d.source.label)+'</p><blockquote>'+e(d.quote)+'</blockquote><p>'+e(d.reason)+'</p><p>帮助方向：'+e(d.help?.intent||'效果待验证')+'</p><p>实际节省：未测得。</p><p>下一步：'+e(d.help?.next||'先取得执行证据')+'</p>'+(d.handoff?'<p>待交接：'+e(d.handoff)+'</p>':'')+'</article>').join('');
 const gaps=[...new Set(coverage.filter(c=>['unsupported','unverified'].includes(c.status)).map(c=>c.dimension+'：'+c.reason))];
 const records=result.groups.map(g=>'<article><h3>'+e(g.path.name)+' · '+e(status[g.status])+'</h3><p>'+e(g.evidence?.label||g.reason)+'；记录 '+g.records.length+' 次。</p><p>依据：'+e(g.path.basis.join('；'))+'</p>'+g.records.map(r=>'<div class="attempt"><p>第 '+r.attempt+' 次：'+e(status[r.status])+'；操作记录 '+e(r.id)+'.json</p>'+r.checks.filter(c=>!c.setup).map(c=>'<p class="check">'+e(c.label)+'：'+e(status[c.status]||c.status)+'<br>预期：'+e(value(c.expected))+'<br>实际：'+e(value(c.actual))+'</p>').join('')+'<p class="note">产物：'+e((r.outputs||[]).join('、')||'无下载产物')+'；现场：'+e((r.snapshots||[]).filter(s=>s.phase.endsWith('-result')).map(s=>s.file).join('、')||'见操作记录')+'</p></div>').join('')+'</article>').join('');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font:12px/1.65 system-ui,"PingFang SC",sans-serif;color:#172e46}h1{font-size:26px}h2{font-size:19px;border-bottom:1px solid #bdc8d2;padding-bottom:8px;margin-top:28px}h3{font-size:14px}article{padding:8px 0;border-bottom:1px solid #dbe2e8}p{margin:5px 0;overflow-wrap:anywhere}blockquote{margin:8px 0;padding:8px 12px;background:#f4f6f8}.note{color:#4e6072;font-size:10px}.check{padding-left:12px}.attempt,.advice-record{margin:10px 0}h2,h3{break-after:avoid}.attempt,.advice-record{break-inside:avoid}</style></head><body><h1>本轮验收报告</h1>'+evidenceWarning+'<p>目标：'+e(task.goal)+'</p><p>检查范围：'+e(task.endpoint)+'</p><p class="note">'+e(result.generatedAt)+' · 各项状态分别报告；入口通过不等于整个产品通过。</p><h2>需要关注的问题</h2>'+(issueHTML||'<p>已覆盖路径没有确认偏差；未验证部分见下文。</p>')+repairHTML(repair,{download:false})+businessAdviceHTML(businessAdvice,adviceFeedbackHistory)+helpEvaluationHTML(helpEvaluation)+'<h2>个人经验实际改变了什么</h2>'+(help||'<p>本轮仅使用当前目标与通用检查。</p>')+'<p class="note">落实要求不等于已证明长期减少返工。</p>'+observationNotesHTML(task)+'<h2>未验证与覆盖边界</h2><ul>'+gaps.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul><h2>复检与证据索引</h2><p class="note">PDF 保留检查结果与文件索引，不嵌入原始截图或证据附件。完整证据须与本轮网页报告或运行目录一起保存。</p>'+records+'</body></html>';
}

export async function reportPDF(html,{id,revision,digest}){
 if(Buffer.byteLength(html)>2000000)throw Error('报告超过本轮 PDF 导出容量');
 const browser=await(await browserEngine()).launch({headless:true});
 try{
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
  await context.route('**/*',r=>r.abort());
  const page=await context.newPage();
  // Only server-produced escaped report markup is passed here. Print all details,
  // including unmet requirements and coverage gaps, without fetching evidence URLs.
  const full=html.replace(/<details\b/g,'<details open').replace('</head>','<style>@page{size:A4}body{background:white!important;font-size:11pt!important}main{max-width:none!important;padding:0!important}details,section,article{overflow:visible!important}article{break-inside:auto!important}.attempt,.discrepancy{break-inside:avoid}p,li,blockquote,a{overflow-wrap:anywhere}h2,h3,h4,summary{break-after:avoid}a{color:#172e46!important}summary{list-style:none}pre{white-space:pre-wrap}table{width:100%}</style></head>');
  await page.setContent(full,{waitUntil:'load'});
  const identity='任务 '+id+' / 第 '+revision+' 版 / '+digest.slice(0,12);
  await page.locator('body').evaluate((b,text)=>{const p=document.createElement('p');p.textContent=text;b.prepend(p);},identity);
  const bytes=await page.pdf({format:'A4',printBackground:true,margin:{top:'16mm',bottom:'18mm',left:'15mm',right:'15mm'},displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;color:#4e6072;width:100%;text-align:center">本轮实际检查记录 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
  return {bytes,hash:bodyHash(bytes)};
 }finally{await browser.close();}
}
