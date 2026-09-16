import test from 'node:test';
import assert from 'node:assert/strict';
import {rebindSnapshotPlan,snapshotRepairEligible,snapshotRepairTask} from './snapshot-repair.mjs';
const oldURL='http://127.0.0.1:12/',newURL='http://127.0.0.1:34/';
const plan={project:'sample',paths:[{id:'expected',location:oldURL,steps:[{type:'goto',path:oldURL}],checks:[{type:'containsText',expected:oldURL}]}]};
const prior={repairSealHash:'sealed',intake:{root:'/imports/first'},receipt:{digest:'digest'},task:{id:'old',digest:'digest',goal:'原目标',expectedText:oldURL,sources:{current:{}},proposedScope:{id:'old',origin:oldURL,actions:[]}},observation:{url:oldURL},executionPlan:plan};
test('snapshot relocation changes only navigation, never an expected URL or the original plan',()=>{
 const next=rebindSnapshotPlan(plan,oldURL,newURL);assert.equal(next.paths[0].steps[0].path,newURL);assert.equal(next.paths[0].checks[0].expected,oldURL);assert.equal(plan.paths[0].location,oldURL);assert.deepEqual(rebindSnapshotPlan(next,newURL,oldURL),plan);
 assert.throws(()=>rebindSnapshotPlan(plan,'http://other/',newURL),/其他页面/);
});
test('completed basic snapshots qualify only with unchanged scope; history and other actions do not migrate',()=>{
 assert.equal(snapshotRepairEligible(prior,'/imports'),true);
 for(const changed of [{repairSealHash:null},{receipt:{digest:'changed'}},{intake:{root:'/imports-other/first'}},{task:{...prior.task,autoExperience:{}}},{executionPlan:{paths:[{steps:[{type:'click'}],checks:[]}]}}])assert.equal(snapshotRepairEligible({...prior,...changed},'/imports'),false);
});
test('new snapshot needs fresh scope and keeps original goal and criteria',()=>{
 const task=snapshotRepairTask(prior,{id:'new',intake:{fingerprint:'new-bytes',fingerprintScope:'scanned'},observation:{url:newURL,readRules:[{fresh:true}]}});
 assert.equal(task.id,'new');assert.equal(task.proposedScope.id,'new');assert.deepEqual(task.proposedScope.requests,[{fresh:true}]);assert.equal(task.expectedText,oldURL);assert.equal(task.goal,'原目标');assert.equal(task.sources.repair.taskId,'old');assert.equal(prior.task.id,'old');
});

test('an untouched unstarted replacement draft keeps the completed baseline across more uploads',()=>{
 const draftTask=snapshotRepairTask(prior,{id:'draft',intake:{fingerprint:'new-bytes'},observation:{url:newURL,readRules:[]}});
 const draft={task:draftTask,intake:{root:'/imports/second'},observation:{url:newURL},repairBaseline:{taskId:'old',hash:'sealed'},repairLinkKind:'user-confirmed-snapshot',repairProjectId:'project',repairCanonicalURL:oldURL,snapshotDraftDigest:draftTask.digest};
 assert.equal(snapshotRepairEligible(draft,'/imports'),true);
 const third=snapshotRepairTask(draft,{id:'third',baselineTaskId:'old',intake:{fingerprint:'third-bytes'},observation:{url:'http://127.0.0.1:56/',readRules:[{fresh:true}]}});
 assert.equal(third.sources.repair.taskId,'old');assert.equal(third.expectedText,oldURL);
 assert.equal(third.plan.paths[0].steps[0].path,'http://127.0.0.1:56/');assert.deepEqual(third.proposedScope.requests,[{fresh:true}]);
 assert.equal(draft.receipt,undefined);assert.equal(draft.executionPlan,undefined);
});
test('edited, started, unrelated or unanchored drafts cannot claim untouched original-standard continuation',()=>{
 const task=snapshotRepairTask(prior,{id:'draft',intake:{fingerprint:'new-bytes'},observation:{url:newURL,readRules:[]}});
 const draft={task,intake:{root:'/imports/second'},repairBaseline:{taskId:'old',hash:'sealed'},repairLinkKind:'user-confirmed-snapshot',repairProjectId:'project',repairCanonicalURL:oldURL,snapshotDraftDigest:task.digest};
 for(const change of [{task:{...task,expectedText:'changed'}},{snapshotDraftDigest:'changed'},{receipt:{digest:task.digest}},{repairBaseline:null},{repairBaseline:{taskId:'unrelated',hash:'sealed'}},{repairProjectId:null},{repairCanonicalURL:null},{repairLinkKind:'other'},{intake:{root:'/imports-other/project'}}])assert.equal(snapshotRepairEligible({...draft,...change},'/imports'),false);
});
