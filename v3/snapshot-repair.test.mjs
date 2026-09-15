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
test('only completed unmodified basic snapshot tasks qualify; history and other actions do not migrate',()=>{
 assert.equal(snapshotRepairEligible(prior,'/imports'),true);
 for(const changed of [{repairSealHash:null},{receipt:{digest:'changed'}},{intake:{root:'/imports-other/first'}},{task:{...prior.task,autoExperience:{}}},{executionPlan:{paths:[{steps:[{type:'click'}],checks:[]}]}}])assert.equal(snapshotRepairEligible({...prior,...changed},'/imports'),false);
});
test('new snapshot needs fresh scope and keeps original goal and criteria',()=>{
 const task=snapshotRepairTask(prior,{id:'new',intake:{fingerprint:'new-bytes',fingerprintScope:'scanned'},observation:{url:newURL,readRules:[{fresh:true}]}});
 assert.equal(task.id,'new');assert.equal(task.proposedScope.id,'new');assert.deepEqual(task.proposedScope.requests,[{fresh:true}]);assert.equal(task.expectedText,oldURL);assert.equal(task.goal,'原目标');assert.equal(task.sources.repair.taskId,'old');assert.equal(prior.task.id,'old');
});
