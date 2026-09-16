import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRepairRuns,compareRepairProgress} from './repair-comparison.mjs';
import {repairHTML} from './repair-evidence.mjs';
import {codexContext} from './codex-context.mjs';
const group=(id,status)=>({pathId:id,status,records:Array.from({length:2},()=>({status,checks:[{status,setup:false}]}))});
const before=()=>({projectId:'sample',programHash:'before',criteriaHash:'frozen',evidenceVerified:true,groups:[group('export','issue'),group('unread','pass')]});
const after=()=>({...before(),programHash:'after',groups:[group('export','pass'),group('unread','pass')]});
const compare=(b=before(),a=after())=>compareRepairRuns(b,a,['export','unread']);
test('changed same-project source and identical criteria can verify a covered repair',()=>{assert.equal(compare().status,'verified-repair');assert.equal(compare().userTimeSavedMs,null);});
test('same version, different project and changed criteria cannot claim repair',()=>{for(const [field,value,status] of [['programHash','before','same-version-repeat'],['projectId','other','different-project'],['criteriaHash','new','criteria-changed']])assert.equal(compare(before(),{...after(),[field]:value}).status,status);});
test('missing evidence, skipped checks and incomplete repetitions remain unverified',()=>{for(const mutate of [a=>a.evidenceVerified=false,a=>a.groups.pop(),a=>a.groups[0].records.pop(),a=>a.groups[0].status='blocked',a=>a.groups[0].records[0].checks=[]]){const a=after();mutate(a);assert.equal(compare(before(),a).status,'unverified');}});
test('duplicate IDs and inconsistent reported passes are rejected',()=>{let a=after();a.groups[1].pathId='export';assert.equal(compare(before(),a).status,'unverified');a=after();a.groups[0].records[0].checks[0].status='issue';assert.equal(compare(before(),a).status,'unverified');});
test('remaining failure and unrelated regressions are not a completed repair',()=>{let a=after();a.groups[0]=group('export','issue');assert.equal(compare(before(),a).status,'still-failing');a=after();a.groups[1]=group('unread','issue');assert.equal(compare(before(),a).status,'regression');});
test('passing baseline is not a repaired issue',()=>{const b={...after(),programHash:'baseline'};assert.equal(compare(b).status,'no-baseline-issue');});

const staged=()=>({b:{...before(),groups:[group('add','issue'),{pathId:'export',status:'blocked',records:[]}]},a:{...after(),groups:[group('add','pass'),group('export','issue')]}});
test('partial repair explains fixed prerequisite and newly checked output without upgrading overall status',()=>{
 const {b,a}=staged(),ids=['add','export'],progress=compareRepairProgress(b,a,ids);assert.deepEqual(progress.fixed.map(x=>x.checkId),['add']);assert.deepEqual(progress.newlyCheckedIssues.map(x=>x.checkId),['export']);assert.deepEqual(progress.regressions,[]);assert.equal(compareRepairRuns(b,a,ids).status,'unverified');assert.equal(progress.userTimeSavedMs,null);assert.match(progress.message,/整体修复仍未确认/);
 const repair={status:'unverified',reason:'等待完整对照',progress};assert.ok(repairHTML(repair).includes(progress.message));assert.ok(repairHTML(repair,{download:false}).includes(progress.message));const context=codexContext({task:{id:'example',revision:1,goal:'核对',digest:'version',plan:{paths:[]}},root:'example',repair}).text;assert.ok(context.includes(progress.message));
});
test('partial progress requires verified equal criteria, changed source and complete matching scope',()=>{
 for(const mutate of [({a})=>a.evidenceVerified=false,({a})=>a.programHash='before',({a})=>a.criteriaHash='other',({a})=>a.projectId='other',({a})=>a.groups.pop(),({a})=>a.groups[1].pathId='add']){const pair=staged();mutate(pair);assert.equal(compareRepairProgress(pair.b,pair.a,['add','export']),null);}
 const {b,a}=staged();a.groups[0].records.pop();const p=compareRepairProgress(b,a,['add','export']);assert.deepEqual(p.fixed,[]);assert.deepEqual(p.stillUnverified.map(x=>x.checkId),['add']);
 assert.equal(compareRepairProgress(before(),after(),['export','unread']),null);
});
test('newly checked pass is not repaired and known regressions remain separate',()=>{
 const {b,a}=staged();b.groups[0]=group('add','pass');a.groups=[group('add','issue'),group('export','pass')];const p=compareRepairProgress(b,a,['add','export']);assert.deepEqual(p.fixed,[]);assert.deepEqual(p.newlyCheckedPasses.map(x=>x.checkId),['export']);assert.deepEqual(p.regressions.map(x=>x.checkId),['add']);
 p.message='<script>untrusted</script>';assert.ok(!repairHTML({progress:p}).includes('<script>'));
});
