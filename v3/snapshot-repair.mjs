import {bodyHash} from '../lib/authorization.mjs';

// Explicit user lineage, not a guess based on folder names or similar contents.
export function snapshotRepairEligible(session,importsDirectory){
 return !!(session?.repairSealHash&&session.intake.root.startsWith(importsDirectory+'/')&&session.receipt?.digest===session.task.digest&&!session.task.autoExperience&&!session.task.sources?.experience&&(!session.task.mode||session.task.mode==='basic')&&session.executionPlan?.paths.length&&session.executionPlan.paths.every(p=>p.steps.every(s=>['goto','fill'].includes(s.type))&&p.checks.every(c=>['visible','containsText','value','overflow'].includes(c.type))));
}
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
export function snapshotRepairTask(prior,{id,intake,observation}){
 const task=structuredClone(prior.task);
 task.id=id;task.revision=1;task.fingerprint=intake.fingerprint;task.fingerprintScope=intake.fingerprintScope;
 task.plan=rebindSnapshotPlan(prior.executionPlan,prior.observation.url,observation.url);
 task.sources.current={...task.sources.current,revision:1};
 task.sources.repair={taskId:prior.task.id,policy:'用户明确选择同项目修改版；保留原检查动作、输入、预期、范围和次数；开始时重新确认本轮范围'};
 task.proposedScope={...task.proposedScope,id,origin:new URL(observation.url).origin,requests:observation.readRules,source:'等待用户开始本轮；旧任务授权不复用'};
 task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));return task;
}
