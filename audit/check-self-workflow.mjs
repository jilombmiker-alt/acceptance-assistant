// Explicit self-review criteria, executed by the product's existing browser engine.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {startWorkbench} from '../v3/workbench.mjs';
import {executePlan} from '../v2/engine.mjs';
import {bodyHash} from '../lib/authorization.mjs';
const out=path.resolve(process.argv[2]||'state/self-flow-'+Date.now());await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({stateDir:path.join(out,'app')});
try{
 const home=await(await fetch(app.origin)).text(),token=home.match(/data-task-token="([a-f0-9]+)"/)[1];
 const post=async(route,data)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
 const project=await post('/import-project',{files:[{path:'index.html',data:Buffer.from('<h1>自检样例</h1>').toString('base64')}]});
 await post('/prepare',{...project,mode:'basic',goal:'检查页面',normalRuns:2});
 const paths=[
  {id:'restore-plan',name:'刷新后恢复已生成计划',steps:[{type:'goto',path:'/'}],checks:[{type:'visible',target:{css:'#chat-start'},expected:true,label:'重新打开首页仍能开始已生成的检查'}]},
  {id:'snapshot-guide',name:'快照项目修复提示正确',steps:[{type:'goto',path:'/'},{type:'click',target:{css:'#chat-help'}}],checks:[{type:'containsText',target:{css:'#chat-answer'},expected:'重新选择文件夹',label:'帮助明确提示修复后重新接入代码'}]}
 ];
 for(const p of paths){p.basis=['用户要求自检；本轮实际操作已复现的恢复与快照指引问题'];p.location='/';p.trigger=p.steps.map(s=>s.type).join(' → ');}
 const plan={project:'验收助手自检',goal:'检查计划恢复与快照复检指引',policy:{normalRuns:2,failureExtraRetries:0,recoveryAttempts:0,actionTimeoutMs:5000},paths};
 const authorization={schemaVersion:1,id:'self-flow-'+crypto.randomUUID(),project:plan.project,origin:app.origin,source:'用户要求使用程序自检并修复；只检查独立自检实例的首页和帮助，不操作真实产品。',allowedEffects:['observe'],actions:[{id:'help',type:'click',target:{css:'#chat-help'},pagePath:'/',effects:['observe'],maxInvocations:2}],requests:['/','/style.css','/app.js','/state','/repair-case.json'].map((p,i)=>({id:'read-'+i,origin:app.origin,method:'GET',pathPattern:p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),bodyHashes:[bodyHash('')]}))};
 const result=await executePlan({baseURL:app.origin,plan,out:path.join(out,'execution'),authorization,authorizationStore:path.join(out,'authorizations')});
 const summary={scope:'Two explicit self-review criteria run by the product engine against a real isolated workbench; not automatic discovery of arbitrary user journeys.',criteriaHash:bodyHash(JSON.stringify(paths)),checks:result.groups.map(g=>({id:g.path.id,status:g.status,records:g.records.map(r=>({status:r.status,checks:r.checks,error:r.error}))}))};
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await app.end();await app.close();}
