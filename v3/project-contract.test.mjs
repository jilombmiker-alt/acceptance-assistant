import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {compileProjectContractTask,loadProjectContract,projectContractMode} from './project-contract.mjs';

const contract={schemaVersion:1,project:'陌生记录工具',goal:'新增、筛选并导出记录',completeContract:true,paths:[
 {id:'entry',name:'页面入口',dimension:'业务逻辑',trigger:'打开页面',basis:['独立验收答案：入口可见'],steps:[{type:'goto',path:'/index.html'}],checks:[{type:'visible',target:{css:'body'},expected:true,label:'页面主体可见'}]},
 {id:'add',name:'新增记录',dimension:'数据正确性',trigger:'填写名称后新增',basis:['独立验收答案：新增后显示记录'],dependsOn:['entry'],steps:[{type:'goto',path:'/index.html'},{type:'fill',target:{label:'名称'},value:'测试记录'},{type:'click',target:{role:'button',name:'新增'}}],checks:[{type:'containsText',target:{css:'#items'},expected:'测试记录',label:'列表显示新增记录'}]}
]};
async function fixture(value=contract){const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-contract-')),bytes=Buffer.from(JSON.stringify(value));await fs.writeFile(path.join(root,'acceptance.spec.json'),bytes);return {root,intake:{root,fingerprint:'f',fingerprintScope:'all',gaps:[],files:[{file:'acceptance.spec.json',sha256:bodyHash(bytes)}]},observation:{url:'http://127.0.0.1:45123/index.html',readRules:[{id:'read',method:'GET',origin:'http://127.0.0.1:45123',pathPattern:'/.*',bodyHashes:[bodyHash('')]}]}};}
test('project contract compiles declared business paths and bounded actions',async()=>{const f=await fixture();try{const task=await compileProjectContractTask({id:'task-contract',intake:f.intake,observation:f.observation,normalRuns:2,userGoal:'检查交付'});assert.equal(task.mode,projectContractMode);assert.deepEqual(task.plan.paths.map(p=>p.id),['entry','add']);assert.equal(task.contract.pathCount,2);assert.ok(task.proposedScope.actions.some(a=>a.type==='click'&&a.effects.includes('test-write')));assert.match(task.gaps.at(-1).reason,/无法仅凭项目自述证明/);}finally{await fs.rm(f.root,{recursive:true,force:true});}});
test('scope removal cascades to dependent paths',async()=>{const f=await fixture();try{const task=await compileProjectContractTask({id:'task-contract',intake:f.intake,observation:f.observation,excludedPaths:['entry']});assert.deepEqual(task.plan.paths,[]);assert.deepEqual(new Set(task.excludedPaths),new Set(['entry','add']));}finally{await fs.rm(f.root,{recursive:true,force:true});}});
test('contract rejects external navigation, undeclared fields, secrets and a changed scanned file',async()=>{for(const mutate of [x=>x.paths[0].steps[0].path='https://example.com/',x=>x.paths[0].surprise=true,x=>x.paths[1].steps[1].value='api_key=sk-secret12345678901234567890',x=>x.paths[0].checks[0].expected='password=sk-secret12345678901234567890']){const value=structuredClone(contract);mutate(value);const f=await fixture(value);try{await assert.rejects(compileProjectContractTask({id:'task-contract',intake:f.intake,observation:f.observation}),/必须属于|不支持字段|疑似凭据/);}finally{await fs.rm(f.root,{recursive:true,force:true});}}
 const f=await fixture();try{await fs.writeFile(path.join(f.root,'acceptance.spec.json'),'{}');await assert.rejects(loadProjectContract(f.root,f.intake),/扫描版本不一致/);}finally{await fs.rm(f.root,{recursive:true,force:true});}
});
