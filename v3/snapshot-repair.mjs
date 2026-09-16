import {bodyHash} from '../lib/authorization.mjs';
import {sanitize} from '../lib/privacy.mjs';

// Only a completed run is evidence. An untouched replacement draft can retain its
// existing completed baseline, but never become a baseline of its own.
export function snapshotRepairSource(session,importsDirectory){
 const task=session?.task;
 if(!task||!session.intake?.root?.startsWith(importsDirectory+'/')||task.autoExperience||task.sources?.experience||(task.mode&&task.mode!=='basic'))return null;
 const basic=plan=>Array.isArray(plan?.paths)&&plan.paths.length>0&&plan.paths.every(p=>Array.isArray(p.steps)&&p.steps.every(s=>['goto','fill'].includes(s.type))&&Array.isArray(p.checks)&&p.checks.every(c=>['visible','containsText','value','overflow'].includes(c.type)));
 if(session.repairSealHash&&session.receipt?.digest===task.digest&&basic(session.executionPlan))return {kind:'completed',baseline:{taskId:task.id,hash:session.repairSealHash,file:session.repairSealFile}};
 const b=session.repairBaseline;
 if(!session.receipt&&!session.repairSealHash&&session.snapshotDraftDigest===task.digest&&task.digest===bodyHash(JSON.stringify({...task,digest:undefined}))&&session.repairLinkKind==='user-confirmed-snapshot'&&session.repairProjectId&&session.repairCanonicalURL&&b?.taskId&&b.hash&&task.sources?.repair?.taskId===b.taskId&&basic(task.plan))return {kind:'draft',baseline:{...b}};
 return null;
}
export function snapshotRepairEligible(session,importsDirectory){return !!snapshotRepairSource(session,importsDirectory);}
export function rebindSnapshotPlan(plan,from,to){
 const copy=structuredClone(plan);
 for(const p of copy.paths){
  if(p.location!==from)throw Error('原检查包含其他页面，暂不能跨快照复检');
  p.location=to;
  for(const step of p.steps)if(step.type==='goto'){
   if(step.path!==from)throw Error('原检查包含其他页面，暂不能跨快照复检');
   step.path=to;
  }
 }
 return copy;
}
// Refresh only current intake/observation conditions, not requirements or checks.
export function snapshotObservationGaps(task,intake,observation){
 const replaced=new Set(['intake','mapping','observation','document-unavailable']);
 const gaps=(task.gaps||[]).filter(g=>!replaced.has(g.kind));
 for(const reason of intake.gaps||[])if(!reason.startsWith('未找到明确目标'))gaps.push({kind:'intake',reason});
 if(observation.blocked?.length){
  const paths=[...new Set(observation.blocked.map(r=>String(r.path).slice(0,120)))];
  gaps.push({kind:'observation',reason:'当前上传版本有未读取的请求（'+paths.slice(0,3).join('、')+(paths.length>3?'等':'')+'）。请核对是否漏传资源或依赖超出读取范围；系统不会自动放开请求，原检查仍保留。'});
 }
 const missing=(task.plan?.paths||[]).filter(p=>p.steps.some(s=>s.type==='fill'&&!(observation.fields||[]).some(f=>JSON.stringify(f.target)===JSON.stringify(s.target))));
 if(missing.length)gaps.push({kind:'mapping',reason:'本次页面观察未对应原输入定位：'+missing.slice(0,3).map(p=>p.name).join('、')+(missing.length>3?'等':'')+'。原检查仍保留，需按原步骤核对；这不是已确认的业务失败。'});
 gaps.push(...(observation.reportGaps||[]).filter(g=>g.kind==='document-unavailable'));
 return sanitize(gaps.filter((g,i,all)=>all.findIndex(x=>x.kind===g.kind&&x.reason===g.reason)===i));
}
export function snapshotRepairTask(prior,{id,intake,observation,baselineTaskId=prior.task.id}){
 const task=structuredClone(prior.task);
 task.id=id;task.revision=1;task.fingerprint=intake.fingerprint;task.fingerprintScope=intake.fingerprintScope;
 task.plan=rebindSnapshotPlan(prior.receipt?prior.executionPlan:prior.task.plan,prior.observation.url,observation.url);
 task.gaps=snapshotObservationGaps(task,intake,observation);
 task.sources.current={...task.sources.current,revision:1};
 task.sources.repair={taskId:baselineTaskId,policy:'用户明确选择同项目修改版；保留原检查动作、输入、预期、范围和次数；开始时重新确认本轮范围'};
 task.proposedScope={...task.proposedScope,id,origin:new URL(observation.url).origin,requests:observation.readRules,source:'等待用户开始本轮；旧任务授权不复用'};
 task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));return task;
}
