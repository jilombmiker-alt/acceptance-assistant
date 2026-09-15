import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyHash} from '../lib/authorization.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {evaluationVersion,comparisonMetrics,buildHelpEvaluation,evaluateHelpPair,helpEvaluationHTML,decisionHelp} from './help-evaluation.mjs';

function pair(){
 const criteria=[{id:'file-correct',severity:'critical'},{id:'report-readable',severity:'minor'}];
 const context=Object.fromEntries(['taskHash','initialRequestHash','initialArtifactHash','modelConfigHash','toolsHash','budgetHash'].map(x=>[x,bodyHash(x)]));context.rubricHash=bodyHash(JSON.stringify(criteria));
 const protocol={version:evaluationVersion,frozenAt:'2026-09-13T01:00:00Z',primaryMetric:'repeatExplanationCount',minimumReduction:1,maxExtra:{userActiveMs:0,systemWaitMs:1000,costMinor:1},completeRubric:true,currency:'CNY',criteria,context};
 const arm=(name)=>({arm:name,historyEnabled:name==='B',protocolHash:bodyHash(JSON.stringify(protocol)),startedAt:'2026-09-13T02:00:00Z',historyCutoff:'2026-09-13T00:00:00Z',historySnapshotHash:bodyHash('history'),context:{...context},observationKind:'controlled',completed:true,includesHistorySetupAndMaintenance:true,currency:'CNY',acceptance:criteria.map(c=>({id:c.id,status:'pass',reviewed:true,evidence:['controlled-fixture']})),metrics:Object.fromEntries(comparisonMetrics.map(m=>[m.id,{status:'observed',value:0,reviewed:true,evidence:['controlled-fixture']}]))});
 const a=arm('A'),b=arm('B');a.metrics.repeatExplanationCount.value=2;b.metrics.repeatExplanationCount.value=1;
 return {protocol,arms:[a,b]};
}
const refresh=p=>p.arms.forEach(a=>a.protocolHash=bodyHash(JSON.stringify(p.protocol)));
test('same accepted result and preregistered benefit; controlled remains controlled',()=>{const r=evaluateHelpPair(pair());assert.equal(r.status,'efficiency-benefit');assert.match(r.scope,/不能证明真人/);assert.equal(r.deltas.repeatExplanationCount.saved,1);});
test('faster but newly wrong result is negative even when another item improves',()=>{const p=pair();p.arms[1].acceptance[0].status='fail';p.arms[0].acceptance[1].status='fail';assert.equal(evaluateHelpPair(p).status,'negative');});
test('better result with slower waiting is quality benefit with disclosed exceeded burden',()=>{const p=pair();p.arms[0].acceptance[0].status='fail';p.arms[1].metrics.systemWaitMs.value=2000;const r=evaluateHelpPair(p);assert.equal(r.status,'quality-benefit');assert.equal(r.netBenefit,'not-established');});
test('adding paths or fewer total rounds cannot substitute for the selected metric',()=>{const p=pair();p.arms[1].metrics.repeatExplanationCount.value=2;p.arms[0].totalRounds=9;p.arms[1].totalRounds=1;p.arms[1].paths=30;assert.equal(evaluateHelpPair(p).status,'no-benefit');});
test('different model capability blocks attribution',()=>{const p=pair();p.arms[0].context.modelConfigHash='fixed-rules';assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');});
test('missing metric is unknown, never zero',()=>{const p=pair();p.arms[1].metrics.userActiveMs.value=null;assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');});
test('backend submissions are not reviewed human observations',()=>{const p=pair();p.arms[1].metrics.repeatExplanationCount.status='api-count';assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');});
test('incomplete rubric and missing result both prevent a benefit claim',()=>{const p=pair();p.protocol.completeRubric=false;refresh(p);assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');const q=pair();q.arms[1].acceptance.pop();assert.equal(evaluateHelpPair(q).status,'insufficient-evidence');});
test('post-hoc protocol, changed protocol binding and future history are rejected',()=>{for(const change of [p=>{p.protocol.frozenAt='2026-09-13T03:00:00Z';refresh(p);},p=>p.protocol.minimumReduction=0.5,p=>p.arms[1].historyCutoff='2026-09-13T03:00:00Z']){const p=pair();change(p);assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');}});
test('abandoned task cannot count as fewer rounds',()=>{const p=pair();p.arms[1].completed=false;assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');});
test('history maintenance and setup burden is mandatory',()=>{const p=pair();p.arms[1].includesHistorySetupAndMaintenance=false;assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');});
test('wrongly applied history invalidates nominal time improvement',()=>{const p=pair();p.arms[1].metrics.misappliedHistoryCount.value=1;assert.equal(evaluateHelpPair(p).status,'negative');});
test('excess setup/active time prevents efficiency claim',()=>{const p=pair();p.arms[1].metrics.userActiveMs.value=500;assert.equal(evaluateHelpPair(p).status,'negative');});
test('fewer explanations cannot conceal more rework or supervision',()=>{for(const id of ['correctionReworkCount','supervisionCount']){const p=pair();p.arms[1].metrics[id].value=1;assert.equal(evaluateHelpPair(p).status,'negative');}});
test('results still failing cannot establish success',()=>{const p=pair();p.arms.forEach(a=>a.acceptance[0].status='fail');assert.equal(evaluateHelpPair(p).status,'no-benefit');});
test('invalid counts, empty evidence, mixed human/synthetic and currencies fail closed',()=>{for(const change of [p=>p.arms[1].metrics.detourCount.value=-1,p=>p.arms[0].metrics.detourCount.evidence=[],p=>p.arms[1].observationKind='human',p=>p.arms[1].currency='USD']){const p=pair();change(p);assert.equal(evaluateHelpPair(p).status,'insufficient-evidence');}});
test('execution pass does not imply accepted result, savings, or post-fix retest',()=>{
 const task={id:'example',revision:1,normalRuns:2,excludedPaths:[],plan:{paths:[{id:'p'}]}};
 const result={groups:[{path:{id:'p'},status:'pass',records:[{},{}]}]};
 const r=buildHelpEvaluation({task,result,coverage:[]});
 assert.equal(r.acceptance.covered,1);assert.equal(r.acceptance.status,'unverified');assert.ok(r.metrics.every(m=>m.value===null));assert.equal(r.observations.contextSubmissions,null);assert.equal(r.retest.status,'unverified');assert.match(helpEvaluationHTML(r),/单凭次数不能确认修复/);
});
test('backend observation counters remain separate and only successful submissions count',()=>{
 const task={id:'example',revision:1,normalRuns:2,excludedPaths:['old'],plan:{paths:[{id:'new'}]}};
 const r=buildHelpEvaluation({task,measurements:{events:[{kind:'opinion',elapsedMs:50,success:true},{kind:'opinion',elapsedMs:20,success:false}]}});
 assert.equal(r.observations.feedbackSubmissions,1);assert.equal(r.observations.serviceProcessingMs,70);assert.equal(r.acceptance.excluded,1);assert.equal(r.metrics[0].value,null);assert.equal(r.acceptance.covered,0);
});
test('help chain remains hypothesis and markup is escaped',()=>{
 const d={decision:'apply',mappedPaths:['p'],outcome:'requirement-not-met'};assert.match(decisionHelp(d).next,/新版本/);assert.equal(decisionHelp(d).saved.value,null);
 const task={id:'x',revision:1,normalRuns:2,plan:{paths:[]}};const r=buildHelpEvaluation({task});r.verdict.reason='<img onerror=alert(1)>';assert.ok(!helpEvaluationHTML(r).includes('<img'));
});
test('offline runner freezes protocol, verifies source hashes and refuses overwrite/tamper',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'help-evaluation-')),run=promisify(execFile),script=fileURLToPath(new URL('../scripts/evaluate-help-pair.mjs',import.meta.url));
 try{
  const p=pair(),spec=path.join(dir,'spec.json'),frozen=path.join(dir,'protocol.json');await fs.writeFile(spec,JSON.stringify(p.protocol));
  await run(process.execPath,[script,'--freeze',spec,frozen]);p.protocol=JSON.parse(await fs.readFile(frozen));refresh(p);
  await assert.rejects(run(process.execPath,[script,'--freeze',spec,frozen]));
  const bytes='受控测试证据；这里的数值只检验程序判定，不代表真人。';await fs.writeFile(path.join(dir,'evidence.txt'),bytes);
  for(const arm of p.arms){arm.startedAt=new Date(Date.parse(p.protocol.frozenAt)+1).toISOString();arm.evidenceFiles=[{id:'controlled-fixture',file:'evidence.txt',sha256:bodyHash(bytes)}];await fs.writeFile(path.join(dir,arm.arm+'.json'),JSON.stringify(arm));}
  const output=path.join(dir,'result.json'),args=[script,'--evaluate',frozen,path.join(dir,'A.json'),path.join(dir,'B.json'),output];
  await run(process.execPath,args);const r=JSON.parse(await fs.readFile(output));assert.equal(r.status,'efficiency-benefit');assert.equal(r.evidenceChecks.length,2);
  await assert.rejects(run(process.execPath,args));
  await fs.writeFile(path.join(dir,'evidence.txt'),'changed');await assert.rejects(run(process.execPath,[...args.slice(0,-1),path.join(dir,'changed-result.json')]));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
