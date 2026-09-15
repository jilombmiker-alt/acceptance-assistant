// Shared by the workbench, HTML/PDF reports and the paired evaluation runner.
// Execution evidence is deliberately not promoted to human benefit evidence.
import {bodyHash} from '../lib/authorization.mjs';
export const evaluationVersion='personal-help-v1';
export const helpDimensions=[
 {id:'repeatExplanationCount',label:'重复解释',unit:'次',saving:'少回忆、整理和重述已确认要求',rule:'仅计适用历史已经明确、当前任务仍需用户重述的要求；新需求不计。'},
 {id:'recurringErrorCount',label:'重复犯错',unit:'项',saving:'少发现和纠正同类错误',rule:'按预先固定的验收项统计适用的历史问题复发；同一错误复现多次只计一项。'},
 {id:'correctionReworkCount',label:'纠错返工',unit:'轮',saving:'少推翻和重做已完成工作',rule:'因误解既有目标或约束而重做计一轮；正常新增需求不计。'},
 {id:'detourCount',label:'不必要绕行',unit:'步',saving:'少切换工具、复制和走错步骤',rule:'依据固定目标路径标注额外操作，不以总点击数替代。'},
 {id:'supervisionCount',label:'人工盯守',unit:'次',saving:'少提醒、追问和逐项确认',rule:'只计为推动任务正确完成而发生的必要人工介入；历史采纳操作也计入负担。'}
];
export const comparisonMetrics=[...helpDimensions,
 {id:'userActiveMs',label:'用户实际操作时间',unit:'毫秒'},
 {id:'systemWaitMs',label:'系统等待时间',unit:'毫秒'},
 {id:'costMinor',label:'模型及工具费用',unit:'最小货币单位'},
 {id:'misappliedHistoryCount',label:'错误套用历史',unit:'项'}
];
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const unknown=reason=>({status:'unmeasured',value:null,reason});

export function decisionHelp(d){
 const active=d.decision==='apply'&&(d.mappedPaths?.length||d.alreadyCovered);
 return {
  dimensions:active?['repeatExplanationCount','recurringErrorCount','correctionReworkCount']:d.handoff&&d.decision==='suggest'?['correctionReworkCount']:[],
  intent:active?'希望减少重复解释、同类错误和纠错返工；效果待对照':d.decision==='clarify'?'关键冲突需要补充信息；本次追问属于额外负担':d.handoff&&d.decision==='suggest'?'已准备改进说明，是否减少返工待实际执行':'本条没有新增可执行帮助',
  saved:unknown('没有同条件对照与人工行为记录，不能推算省下的轮次或时间'),
  extra:{plannedPaths:d.mappedPaths?.length||0,questions:d.decision==='clarify'?1:0},
  next:d.decision==='clarify'?'补充关键背景后重新判断，其他独立检查继续':d.outcome==='requirement-not-met'?'修正对应结果后，在新版本重新验收；保留本轮失败证据':d.outcome==='requirement-met'?'在新的适用任务中检验是否减少用户介入':'完成对应动作并取得结果，再判断是否有帮助'
 };
}

export function buildHelpEvaluation({task,result,automatic,coverage=[],measurements}){
 const groups=result?.groups||[],records=groups.flatMap(g=>g.records||[]),decisions=automatic?.decisions||[];
 const expected=(task?.plan?.paths||[]).filter(p=>!(task.excludedPaths||[]).includes(p.id));
 const byId=new Map(groups.map(g=>[g.path.id,g]));
 const confirmed=g=>g&&['pass','issue'].includes(g.status)&&g.records?.length>=task.normalRuns;
 const checked=expected.filter(p=>confirmed(byId.get(p.id))).length;
 const failed=groups.filter(g=>g.status==='issue').length;
 const calls=automatic?.call;
 const events=measurements?.events||[];
 return {
  version:evaluationVersion,taskId:task.id,revision:task.revision,
  verdict:{status:'insufficient-evidence',label:'尚未证明用户收益',reason:'本轮记录执行变化；缺少同条件对照、完整结果验收和人工行为测量。'},
  acceptance:{status:'unverified',label:'最终目标是否完整达成：未验证',reason:'已覆盖检查不等于完整目标验收，缺项与移除项不算通过。',covered:checked,planned:expected.length,issues:failed,gaps:coverage.filter(c=>['unverified','unsupported'].includes(c.status)).length,excluded:(task.excludedPaths||[]).length},
  metrics:helpDimensions.map(m=>({...m,...unknown('未采集经过复核的真人行为对照；不把模型推断记为实测')})),
  observations:{
   addedPaths:decisions.reduce((n,d)=>n+(d.mappedPaths?.length||0),0),
   associatedExisting:decisions.reduce((n,d)=>n+(d.alreadyCovered||0),0),
   executedPersonalPaths:decisions.reduce((n,d)=>n+(d.executedPaths||0),0),
   clarificationQuestions:decisions.filter(d=>d.decision==='clarify').length,
   executionAttempts:records.length,
   semanticMs:number(calls?.elapsedMs)?calls.elapsedMs:null,
   semanticUsage:calls?.usage||null,
   serviceProcessingMs:measurements?events.reduce((n,e)=>n+(number(e.elapsedMs)?e.elapsedMs:0),0):null,
   contextSubmissions:measurements?events.filter(e=>e.kind==='prepare'&&e.contextSubmitted&&e.success).length:null,
   feedbackSubmissions:measurements?events.filter(e=>e.kind==='opinion'&&e.success).length:null,
   revisionSubmissions:measurements?events.filter(e=>e.kind==='revise'&&e.success).length:null
  },
  burden:{userActiveMs:unknown('后台接口耗时不能代表用户操作时间'),systemWaitMs:unknown('尚未测量用户实际等待区间；模型耗时单列'),costMinor:unknown('没有已核对的费用账单；令牌数不换算成费用'),historySetupMs:unknown('首次整理历史及后续维护时间尚未测量，不能忽略这部分成本')},
  retest:{status:'unverified',label:'以上次数仅统计本任务内的重复执行，单凭次数不能确认修复',reason:'跨版本结论见单独的“本次复检”关联；未提供关联时修复状态未验证。新任务上的复发另行观察。'},
  next:'下一步：固定同一任务、模型和验收标准，比较有无相关历史；优先测重复解释与纠错返工。',
  records:decisions.map(d=>({id:d.id,source:d.source,summary:d.summary,reason:d.reason,change:d.change,outcome:d.outcome,evidence:d.evidence||[],help:decisionHelp(d)}))
 };
}

// A protocol is frozen BEFORE both arms start. Metrics are reviewed observations,
// never raw API submission counts. The caller must retain the cited evidence.
export function evaluateHelpPair({protocol,arms}){
 const missing=[],finish=(status,label,reason,extra={})=>({version:evaluationVersion,status,label,reason,scope:arms?.[0]?.observationKind==='human'?'本对照真人观察，不能外推长期效果':'受控验证，不能证明真人收益',missing,...extra});
 const p=protocol,a=arms?.[0],b=arms?.[1];
 if(!p||!a||!b||arms.length!==2)return finish('insufficient-evidence','证据不足','需要预先固定的标准与 A/B 两组记录');
 const ids=comparisonMetrics.map(m=>m.id),primary=ids.includes(p.primaryMetric)&&!['misappliedHistoryCount','costMinor'].includes(p.primaryMetric);
 if(a.protocolHash!==bodyHash(JSON.stringify(p))||b.protocolHash!==bodyHash(JSON.stringify(p)))missing.push('执行记录未绑定同一份冻结标准');
 if(p.version!==evaluationVersion||!primary||!number(p.minimumReduction)||p.minimumReduction<=0)missing.push('主指标及最小有意义改善值须预先固定');
 const frozen=Date.parse(p.frozenAt),startA=Date.parse(a.startedAt),startB=Date.parse(b.startedAt);
 if(!Number.isFinite(frozen)||!Number.isFinite(startA)||!Number.isFinite(startB)||frozen>=Math.min(startA,startB))missing.push('标准必须在两组执行前固定');
 if(a.arm!=='A'||b.arm!=='B'||a.historyEnabled!==false||b.historyEnabled!==true)missing.push('A 无个人历史，B 有个人历史');
 for(const key of ['taskHash','initialRequestHash','initialArtifactHash','modelConfigHash','toolsHash','budgetHash','rubricHash']){
  if(!p.context?.[key]||a.context?.[key]!==p.context[key]||b.context?.[key]!==p.context[key])missing.push('两组条件未一致：'+key);
 }
 if(!b.historySnapshotHash||!Number.isFinite(Date.parse(b.historyCutoff))||Date.parse(b.historyCutoff)>Math.min(startA,startB))missing.push('历史快照须在两组开始前截断');
 if(!['human','controlled'].includes(a.observationKind)||a.observationKind!==b.observationKind)missing.push('观察类型缺失或两组不一致');
 const criteria=p.criteria||[];
 if(p.context?.rubricHash!==bodyHash(JSON.stringify(criteria)))missing.push('验收项与冻结标准指纹不一致');
 if(!criteria.length||new Set(criteria.map(c=>c.id)).size!==criteria.length||criteria.some(c=>!c.id||!['critical','major','minor'].includes(c.severity)))missing.push('缺少稳定且有影响分级的完整验收项');
 if(p.completeRubric!==true)missing.push('尚未确认验收标准覆盖最终目标');
 const observed=(m)=>m&&m.status==='observed'&&number(m.value)&&m.reviewed===true&&Array.isArray(m.evidence)&&m.evidence.length&&m.evidence.every(x=>typeof x==='string'&&x.trim());
 for(const arm of arms){
  if(arm.completed!==true)missing.push(arm.arm+' 未完成，不能当作更快或更少轮次');
  for(const id of ids)if(!observed(arm.metrics?.[id])||(id.endsWith('Count')&&!Number.isSafeInteger(arm.metrics[id].value)))missing.push(arm.arm+' 未测得或未复核：'+id);
  if(arm.includesHistorySetupAndMaintenance!==true)missing.push(arm.arm+' 未计入历史接入和维护负担');
  if(!Array.isArray(arm.acceptance)||arm.acceptance.length!==criteria.length||new Set(arm.acceptance.map(x=>x.id)).size!==criteria.length)missing.push(arm.arm+' 验收项数量不一致');
  for(const c of criteria){const r=Array.isArray(arm.acceptance)?arm.acceptance.find(r=>r.id===c.id):null;if(!r||!['pass','fail'].includes(r.status)||r.reviewed!==true||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.some(x=>typeof x!=='string'||!x.trim()))missing.push(arm.arm+' 缺少结果证据：'+c.id);}
 }
 for(const id of ['userActiveMs','systemWaitMs','costMinor'])if(!number(p.maxExtra?.[id]))missing.push('未预设额外负担上限：'+id);
 if(!p.currency||a.currency!==p.currency||b.currency!==p.currency)missing.push('费用币种缺失或不一致');
 if(missing.length)return finish('insufficient-evidence','证据不足','不可将现有差异归因为个人历史');
 const deltas=Object.fromEntries(ids.map(id=>[id,{A:a.metrics[id].value,B:b.metrics[id].value,saved:a.metrics[id].value-b.metrics[id].value}]));
 const worse=criteria.filter(c=>a.acceptance.find(x=>x.id===c.id).status==='pass'&&b.acceptance.find(x=>x.id===c.id).status==='fail');
 const improved=criteria.filter(c=>a.acceptance.find(x=>x.id===c.id).status==='fail'&&b.acceptance.find(x=>x.id===c.id).status==='pass');
 const passA=a.acceptance.every(x=>x.status==='pass'),passB=b.acceptance.every(x=>x.status==='pass');
 const extraExceeded=[...['userActiveMs','systemWaitMs','costMinor'].filter(id=>-deltas[id].saved>p.maxExtra[id]),...helpDimensions.filter(m=>deltas[m.id].saved<0).map(m=>m.id)];
 const evidence={deltas,acceptance:{A:passA,B:passB,improved:improved.map(c=>c.id),regressed:worse.map(c=>c.id)},extraExceeded,primaryMetric:p.primaryMetric};
 if(worse.length||deltas.misappliedHistoryCount.saved<0)return finish('negative','本次有负面影响','新增验收失败或错误套用历史，不能用小项改善抵消',evidence);
 if(improved.length&&passB)return finish('quality-benefit','本次有质量收益',extraExceeded.length?'最终结果改善，但额外负担超过预设上限；不认定净收益':'最终结果改善；时间与费用代价分别保留',{...evidence,netBenefit:extraExceeded.length?'not-established':'within-budget'});
 if(!passB)return finish('no-benefit','尚未证明收益','最终目标未通过验收',evidence);
 if(extraExceeded.length)return finish('negative','额外负担超出约定','本次成本超过实验前约定的可接受范围',evidence);
 if(passA&&deltas[p.primaryMetric].saved>=p.minimumReduction)return finish('efficiency-benefit','本次有指标收益','两组同样合格，预先选定的主指标改善达到门槛，额外负担在约定范围内',evidence);
 return finish('no-benefit','尚未证明收益','主指标改善未达到预设门槛；不事后改选更好看的指标',evidence);
}

// Self-contained so exactly the same escaped content can be rendered in browser
// JS and server HTML/PDF. No model-produced markup or executable code is accepted.
export function helpEvaluationHTML(a){
 if(!a)return '';
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=x=>x===null||x===undefined?'未测得':String(x);
 const o=a.observations;
 return '<h2>个人历史有没有帮上忙</h2><p><strong>'+e(a.verdict.label)+'</strong> · '+e(a.verdict.reason)+'</p><p>'+e(a.acceptance.label)+'。已重复核对 '+a.acceptance.covered+' / '+a.acceptance.planned+' 条计划路径，发现 '+a.acceptance.issues+' 条偏差；覆盖缺项 '+a.acceptance.gaps+' 条，移除 '+a.acceptance.excluded+' 条。</p><details><summary>查看五个帮助维度与审评标准</summary>'+a.metrics.map(m=>'<article class="help-metric"><h3>'+e(m.label)+' · 未测得</h3><p>希望节省：'+e(m.saving)+'。</p><p>'+e(m.rule)+'</p></article>').join('')+'<p>主要看最终验收、重复解释和纠错返工；轮次、点击数、报告长度不单独算收益。不使用加权总分。</p></details><details><summary>查看已发生的变化与新增负担</summary><p>新增检查 '+o.addedPaths+' 条；关联已有检查 '+o.associatedExisting+' 项；已执行个人检查 '+o.executedPersonalPaths+' 条；提出关键问题 '+o.clarificationQuestions+' 个。</p><p>本任务接口提交：历史文本 '+n(o.contextSubmissions)+' 次，反馈 '+n(o.feedbackSubmissions)+' 次，计划修订 '+n(o.revisionSubmissions)+' 次。它们不是用户重复解释、返工或对话轮次。</p><p>语义调用耗时 '+(o.semanticMs===null?'未测得':(o.semanticMs/1000).toFixed(2)+' 秒')+'；服务处理累计 '+(o.serviceProcessingMs===null?'未测得':(o.serviceProcessingMs/1000).toFixed(2)+' 秒')+'。用户操作时间、实际等待、历史整理维护时间及费用均未测得；不折算节省。</p><p>已有 '+o.executionAttempts+' 次执行记录。'+e(a.retest.label)+'；'+e(a.retest.reason)+'</p></details><p>'+e(a.next)+'</p>';
}
