import test from 'node:test';
import assert from 'node:assert/strict';
import {businessAdvice,businessAdviceHTML,executionCounts} from './business-advice.mjs';
import {codexContext} from './codex-context.mjs';
const fixture=()=>({task:{id:'task-advice',mode:'reviewed-reading',goal:'导出',revision:1,digest:'v1',plan:{paths:[{id:'export'}]}},evidenceVerified:true,result:{groups:[{path:{id:'export',name:'导出',location:'清单',trigger:'下载',basis:['README.md:11']},status:'issue',records:[0,1].map(i=>({id:'export-'+i,status:'issue',outputs:['export-'+i+'.json'],checks:[{status:'issue',expected:{read:true},actual:{read:false},label:'状态'}]}))}]}});
test('export advice links repeated output differences without asserting a root cause or benefit',()=>{const a=businessAdvice(fixture())[0];assert.equal(a.kind,'product-mismatch');assert.equal(a.facts[0].records.length,2);assert.match(a.unknown,/尚未证明具体根因/);assert.match(a.next,/核对/);assert.match(a.recheck,/至少两次/);assert.equal(a.userTimeSavedMs,null);});
test('missing seal, output, repetition or executor completion becomes evidence gap',()=>{for(const mutate of [x=>x.evidenceVerified=false,x=>x.result.groups[0].records.pop(),x=>x.result.groups[0].records[0].outputs=[],x=>x.result.groups[0].status='unverified']){const f=fixture();mutate(f);const a=businessAdvice(f)[0];assert.equal(a.kind,'evidence-gap');assert.equal(a.facts.length,0);assert.match(a.next,/不先判定业务根因/);}});
test('feedback changes the suggested next step, never its measured effect or execution result',()=>{for(const decision of ['accept','reject','correct']){const f=fixture(),id=businessAdvice(f)[0].id;f.opinions=[{adviceId:id,adviceDecision:decision,text:'<script>override</script>'}];const a=businessAdvice(f)[0];assert.equal(a.decision,decision);assert.equal(a.effectStatus,'unmeasured');assert.equal(f.result.groups[0].status,'issue');if(decision==='reject')assert.match(a.next,/已拒绝/);assert.ok(!businessAdviceHTML([a]).includes('<script>'));const text=codexContext({task:f.task,root:'/fixture',businessAdvice:[a]}).text;assert.match(text,/不授予执行权限/);assert.match(text,/"effectStatus":"unmeasured"/);}});
test('resolved, unrelated and inactive paths do not create current export advice',()=>{for(const mutate of [f=>f.task.mode='basic',f=>f.result.groups[0].status='pass',f=>f.task.plan.paths=[]]){const f=fixture();mutate(f);assert.deepEqual(businessAdvice(f),[]);}});

function blockedFixture({incomplete=false}={}){
 const f=fixture(),root={...f.result.groups[0],path:{id:'add',name:'新增书目',location:'新增',trigger:'添加',basis:[]},reason:'新增未完成'};
 root.records=root.records.map((r,i)=>({...r,id:'add-'+i,outputs:[],checks:[{label:'数量',status:'issue',expected:2,actual:0}]}));
 if(incomplete){root.status='unverified';root.records=[{id:'add-0',status:'unverified',checks:[],firstDeviation:{kind:'executor-incomplete'},reason:'找不到控件'}];}
 const blocked=(id,dependsOn)=>({path:{id,name:id,dependsOn},status:'blocked',records:[],reason:'依赖未通过'});
 f.result.groups=[root,blocked('read',['add']),blocked('export',['read']),blocked('export-filter',['read'])];
 f.task.plan.paths=f.result.groups.map(g=>g.path);return f;
}
test('blocked export paths point to one earliest prerequisite without inventing export failures',()=>{
 for(const incomplete of [false,true]){
  const f=blockedFixture({incomplete}),a=businessAdvice(f)[0];assert.equal(a.kind,'prerequisite-blocked');assert.equal(a.blockers.length,1);assert.equal(a.blockers[0].checkId,'add');assert.equal(a.blockers[0].kind,incomplete?'execution-incomplete':'observed-mismatch');assert.match(a.next,/新增书目/);assert.ok(a.facts.every(x=>x.checkId==='add'));assert.equal(a.facts.length,incomplete?0:1);
  const html=businessAdviceHTML([a]);assert.match(html,/待处理环节/);assert.match(html,/不另算为导出缺陷/);assert.equal(executionCounts(f.result).blocked,3);assert.equal(f.result.groups[2].records.length,0);
 }
});
test('missing evidence withholds prerequisite diagnosis, and dependency cycles remain unknown',()=>{
 const f=blockedFixture();f.evidenceVerified=false;let a=businessAdvice(f)[0];assert.equal(a.kind,'evidence-gap');assert.deepEqual(a.blockers,[]);assert.deepEqual(a.facts,[]);
 f.evidenceVerified=true;f.result.groups=f.result.groups.filter(g=>g.path.id!=='add');f.result.groups[0].path.dependsOn=['export'];a=businessAdvice(f)[0];assert.equal(a.kind,'prerequisite-blocked');assert.deepEqual(a.blockers,[]);assert.match(a.next,/不足以定位/);
});
test('an incomplete download keeps content unknown and does not reclassify permission stops',()=>{
 const f=fixture(),g=f.result.groups[0];g.status='unverified';g.records=[{id:'export-0',status:'unverified',checks:[],outputs:[],firstDeviation:{kind:'executor-incomplete'},reason:'等待下载结束'}];let a=businessAdvice(f)[0];assert.equal(a.kind,'execution-incomplete');assert.match(a.next,/下载/);assert.deepEqual(a.facts,[]);assert.equal(a.effectStatus,'unmeasured');
 g.records[0].firstDeviation.kind='permission-stop';assert.equal(businessAdvice(f)[0].kind,'evidence-gap');
});
test('mixed confirmed output and blocked paths retain their separate evidence',()=>{
 const f=blockedFixture(),actual=fixture().result.groups[0];actual.path.id='export-filter';f.result.groups[3]=actual;const a=businessAdvice(f)[0];assert.equal(a.kind,'prerequisite-blocked');assert.deepEqual(a.facts.map(x=>x.checkId),['add','export-filter']);assert.equal(a.affectedPaths.find(x=>x.checkId==='export').status,'blocked');
 const id=a.id;f.opinions=[{adviceId:id,adviceDecision:'reject',text:'<script>no</script>'}];const rejected=businessAdvice(f)[0];assert.match(rejected.next,/已拒绝/);assert.ok(!businessAdviceHTML([rejected]).includes('<script>'));assert.equal(rejected.effectStatus,'unmeasured');
});
test('executor explanation strips terminal escapes and bounds diagnostic text',()=>{
 const f=blockedFixture({incomplete:true});f.result.groups[0].reason='\u001b[2m定位失败\u001b[22m'+('x'.repeat(600));const a=businessAdvice(f)[0];assert.ok(!a.blockers[0].reason.includes('\u001b'));assert.equal(a.blockers[0].reason.length,400);assert.match(a.blockers[0].reason,/定位失败/);
});
