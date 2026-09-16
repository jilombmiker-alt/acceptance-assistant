import {bodyHash} from '../lib/authorization.mjs';

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
export function snapshotRepairTask(prior,{id,intake,observation,baselineTaskId=prior.task.id}){
 const task=structuredClone(prior.task);
 task.id=id;task.revision=1;task.fingerprint=intake.fingerprint;task.fingerprintScope=intake.fingerprintScope;
 task.plan=rebindSnapshotPlan(prior.receipt?prior.executionPlan:prior.task.plan,prior.observation.url,observation.url);
 task.sources.current={...task.sources.current,revision:1};
 task.sources.repair={taskId:baselineTaskId,policy:'用户明确选择同项目修改版；保留原检查动作、输入、预期、范围和次数；开始时重新确认本轮范围'};
 task.proposedScope={...task.proposedScope,id,origin:new URL(observation.url).origin,requests:observation.readRules,source:'等待用户开始本轮；旧任务授权不复用'};
 task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));return task;
}
