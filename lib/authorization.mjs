import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const bodyHash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, Object.keys(value || {}).sort());
const requireValue = (ok,message) => { if(!ok) throw new Error(message); };
export class PermissionStop extends Error {
 constructor(code,message){super(message);this.name='PermissionStop';this.code=code;}
}
const stop=(code,message)=>{throw new PermissionStop(code,message);};
const effects=new Set(['observe','input','test-write','generate','export','video','publish','delete-original']);
const storeDefault=fileURLToPath(new URL('../state/authorizations/',import.meta.url));

export function validateAuthorization(auth,baseURL,project){
 requireValue(auth?.schemaVersion===1&&/^[a-zA-Z0-9-]{1,100}$/.test(auth.id||''),'缺少独立操作授权；请由调用者提供已确认范围，不能从检查计划自动授权');
 requireValue(auth.project===project&&auth.origin===new URL(baseURL).origin,'授权不属于本次项目或入口');
 requireValue(typeof auth.source==='string'&&auth.source.trim(),'授权需保留用户决定的来源说明');
 requireValue(Array.isArray(auth.allowedEffects)&&auth.allowedEffects.every(e=>effects.has(e)),'授权动作范围无效');
 requireValue(Array.isArray(auth.actions)&&Array.isArray(auth.requests),'授权缺少动作和请求范围');
 const ids=new Set();
 for(const a of auth.actions){
  requireValue(a.id&&!ids.has(a.id),'授权动作编号重复或缺失');ids.add(a.id);
  requireValue(['fill','click','select','reload','download'].includes(a.type)&&Array.isArray(a.effects)&&a.effects.length&&a.effects.every(e=>effects.has(e)),'授权动作描述无效');
  requireValue(a.type==='reload'||a.target&&typeof a.target==='object','授权动作缺少控件');
  requireValue(typeof a.pagePath==='string'&&a.pagePath.startsWith('/'),'授权动作需限定页面路径');
  if(a.cost)requireValue(Number.isSafeInteger(a.cost.upperMinor)&&a.cost.upperMinor>=0&&a.cost.currency===auth.budget?.currency,'收费上界或币种无效');
  if(a.effects.some(e=>!['observe','input'].includes(e)))requireValue(Number.isSafeInteger(a.maxInvocations)&&a.maxInvocations>=0,'业务动作必须明确约定次数上限；金额不能代替次数约定');
  if(a.maxInvocations!==undefined)requireValue(Number.isSafeInteger(a.maxInvocations)&&a.maxInvocations>=0,'动作次数上限无效');
  if(a.recovery){
   const r=a.recovery;
   requireValue(r.requestId&&/^[a-zA-Z0-9_.]+$/.test(r.idField||'')&&/^[a-zA-Z0-9_.]+$/.test(r.statusField||''),'原任务查询需明确任务编号及状态字段');
   requireValue(typeof r.pathPrefix==='string'&&r.pathPrefix.startsWith('/')&&!r.pathPrefix.startsWith('//')&&!/[?#\\]/.test(r.pathPrefix),'原任务查询路径无效');
   requireValue(Array.isArray(r.completedValues)&&r.completedValues.length&&Array.isArray(r.failedValues),'原任务终态无效');
  }
 }
 if(auth.budget)requireValue(['CNY','USD'].includes(auth.budget.currency)&&Number.isSafeInteger(auth.budget.limitMinor)&&auth.budget.limitMinor>=0,'预算金额和币种无效；当前以分计价，仅支持 CNY/USD，不自动换汇');
 for(const r of auth.requests){
  requireValue(r.id&&['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(r.method),'请求规则无效');
  requireValue(new URL(r.origin).origin===r.origin&&['http:','https:'].includes(new URL(r.origin).protocol),'请求目标无效');
  requireValue(typeof r.pathPattern==='string'&&r.pathPattern.startsWith('/')&&r.pathPattern.length<500,'请求路径规则无效');
  new RegExp('^(?:'+r.pathPattern+')$');
  requireValue(Array.isArray(r.bodyHashes)&&r.bodyHashes.every(h=>/^[a-f0-9]{64}$/.test(h)),'必须明确允许的请求体指纹，禁止任意内容透传');
  requireValue(r.actionId===undefined||ids.has(r.actionId),'请求引用未知动作');
  requireValue(['GET','HEAD'].includes(r.method)||r.actionId,'写入请求必须关联已授权动作');
  if(r.actionId)requireValue(Number.isSafeInteger(r.maxPerAction??1)&&(r.maxPerAction??1)>0,'单次动作请求数量无效');
 }
 for(const a of auth.actions)if(a.recovery)requireValue(auth.requests.some(r=>r.id===a.recovery.requestId&&r.actionId===a.id),'任务编号来源必须对应已授权动作的请求');
 return auth;
}

// A caller-owned authorization is independent of the model plan. This is not
// multi-user authentication, a browser sandbox, or a classifier for arbitrary UIs.
export async function createAuthorizationGuard({authorization,baseURL,project,storeDir=storeDefault}){
 const auth=structuredClone(validateAuthorization(authorization,baseURL,project));
 await fs.mkdir(storeDir,{recursive:true,mode:0o700});
 const dir=path.join(storeDir,auth.id),fingerprint=bodyHash(JSON.stringify(auth));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 let active=null;const sessionId=crypto.randomUUID(),requestTokens=new WeakMap();
 async function transaction(change,retry=0){
  const lock=path.join(dir,'lock');
  try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST'&&retry>0){await new Promise(r=>setTimeout(r,25));return transaction(change,retry-1);}if(e.code==='EEXIST')stop('ledger-busy','授权状态正在使用或上次中断，未发起新动作；先核对原任务');throw e;}
  try{
   let state;
   try{state=JSON.parse(await fs.readFile(path.join(dir,'ledger.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={authorizationId:auth.id,fingerprint,currency:auth.budget?.currency||null,limitMinor:auth.budget?.limitMinor??null,heldMinor:0,actualMinor:null,actions:[]};}
   if(state.fingerprint!==fingerprint)stop('authorization-changed','同一任务授权已变化，不能重置原费用记录；需显式核对后迁移');
   state.control??={status:'active',revision:0,events:[]};
   const result=change(state);
   const temp=path.join(dir,'ledger.next.json');const file=await fs.open(temp,'w',0o600);
   try{await file.writeFile(JSON.stringify(state,null,2));await file.sync();}finally{await file.close();}
   await fs.rename(temp,path.join(dir,'ledger.json'));
   const parent=await fs.open(dir,'r');try{await parent.sync();}finally{await parent.close();}
   return result;
  }finally{await fs.rmdir(lock);}
 }
 await transaction(()=>{});
 function snapshot(){
  const state=JSON.parse(readFileSync(path.join(dir,'ledger.json'),'utf8'));
  if(state.fingerprint!==fingerprint)stop('authorization-changed','原任务授权已变化，请先核对');
  state.control??={status:'active',revision:0,events:[]};return state;
 }
 function assertActive(state=snapshot()){
  const status=state.control.status;
  if(status!=='active')stop('task-'+status,{paused:'本任务已暂停，保留原任务等待继续',revoked:'本任务授权已撤销，未发起后续操作或请求',ended:'本轮已结束，保留证据，不再执行'}[status]||'任务控制状态无效');
 }
 async function control({command,expectedRevision,limitMinor,confirmed=false}){
  return transaction(state=>{
   if(state.control.revision!==expectedRevision)stop('control-conflict','任务状态已变化，请查看最新状态后操作；未重复追加额度');
   const before=state.control.status;
   if(before==='ended')stop('task-ended','本轮已结束，不能用继续或追加额度重新发起');
   if(command==='pause'){if(before!=='active')stop('invalid-transition','当前状态不能暂停');state.control.status='paused';}
   else if(command==='resume'){if(before!=='paused')stop('invalid-transition','只有暂停的原任务可以继续');state.control.status='active';}
   else if(command==='revoke')state.control.status='revoked';
   else if(command==='restore'){if(before!=='revoked'||!confirmed)stop('explicit-approval-required','恢复已撤销授权需要明确同意原范围');state.control.status='paused';}
   else if(command==='end')state.control.status='ended';
   else if(command==='skip'){
    if(before!=='active'||!state.worker?.running||!state.worker.pathId)stop('invalid-transition','当前没有可跳过的执行路径');
    state.control.skipPathId=state.worker.pathId;
   }
   else if(command==='set-budget'){
    if(!confirmed||!state.currency||!Number.isSafeInteger(limitMinor)||limitMinor<=state.limitMinor)stop('invalid-budget','请明确确认高于当前额度的新总上限，币种及已预留费用保持不变');
    state.limitMinor=limitMinor;
   }else stop('unknown-control','未知任务控制操作');
   state.control.revision++;
   state.control.events.push({command,from:before,to:state.control.status,limitMinor:state.limitMinor,revision:state.control.revision,at:new Date().toISOString()});
   return structuredClone(state);
  },40);
 }
 async function claimWorker({runId,planHash}){
  return transaction(state=>{
   assertActive(state);
   if(state.worker?.running){
    try{process.kill(state.worker.pid,0);stop('worker-active','原执行进程仍在运行，不能启动第二个执行器');}catch(e){if(e.code!=='ESRCH')throw e;}
   }
   if(state.taskPlanHash&&state.taskPlanHash!==planHash)stop('plan-changed','本任务计划已变化，需先核对原任务，不能自动重放');
   state.taskPlanHash=planHash;
   state.worker={id:sessionId,pid:process.pid,runId,running:true,phase:'starting',updatedAt:new Date().toISOString()};
  },40);
 }
 async function progress(detail){return transaction(state=>{if(state.worker?.id===sessionId)Object.assign(state.worker,detail,{updatedAt:new Date().toISOString()});},40);}
 async function releaseWorker(phase){return progress({running:false,phase});}
 const nested=(object,key)=>key.split('.').reduce((value,k)=>value?.[k],object);
 async function captureResponse(response){
  const link=requestTokens.get(response.request());if(!link)return;
  const action=auth.actions.find(a=>a.id===link.actionId),recovery=action?.recovery;
  if(!recovery||recovery.requestId!==link.requestId)return;
  // Only a bounded JSON receipt from an already-authorized request may identify a task.
  const length=Number(response.headers()['content-length']);
  if(!Number.isSafeInteger(length)||length<1||length>65536)return;
  let timer;
  const data=await Promise.race([response.body(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]).finally(()=>clearTimeout(timer));
  if(!data||data.length>65536)return;
  let value;try{value=nested(JSON.parse(data.toString()),recovery.idField);}catch{return;}
  if(typeof value!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(value))return;
  await transaction(state=>{
   const row=state.actions.find(x=>x.id===link.tokenId);
   if(row){if(row.remoteTaskId&&row.remoteTaskId!==value)stop('task-id-changed','同一动作返回不同任务编号，需核对原任务');row.remoteTaskId=value;}
  },40);
 }
 async function queryPending(){
  const start=snapshot();
  if(['revoked','ended'].includes(start.control.status))assertActive(start);
  if(start.worker?.running){try{process.kill(start.worker.pid,0);stop('worker-active','原执行器仍在运行，请使用暂停或继续，不能并行核对');}catch(error){if(error.code!=='ESRCH')throw error;}}
  const results=[];
  for(const row of start.actions.filter(x=>x.state==='pending'&&x.effects.some(e=>!['input','observe'].includes(e)))){
   const action=auth.actions.find(a=>a.id===row.actionId),r=action?.recovery;
   if(!r||!row.remoteTaskId){results.push({id:row.id,state:'unknown',reason:'没有已验证的原任务编号或只读查询适配，未重新提交'});continue;}
   const u=new URL(r.pathPrefix+encodeURIComponent(row.remoteTaskId),auth.origin);
   if(u.origin!==auth.origin)stop('query-outside-scope','原任务查询超出入口范围');
   const current=snapshot();if(['revoked','ended'].includes(current.control.status))assertActive(current);
   let status,reason;
   try{
    const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('查询未成功：HTTP '+response.status);
    let size=0,text='';for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw Error('查询结果超过读取预算');text+=Buffer.from(chunk).toString('utf8');}
    status=nested(JSON.parse(text),r.statusField);
   }catch(error){reason=error.message;}
   const state=r.completedValues.includes(status)?'observed-complete':r.failedValues.includes(status)?'observed-failed':'unknown';
   await transaction(ledger=>{
    const item=ledger.actions.find(x=>x.id===row.id);if(item.state!=='pending')return;
    item.reconciliation={state,at:new Date().toISOString(),remoteTaskId:row.remoteTaskId};
    if(state!=='unknown')item.state=state;
   },40);
   results.push({id:row.id,remoteTaskId:row.remoteTaskId,state,...(reason?{reason}:{})});
  }
  return results;
 }
 function checkAction(step,pageURL){
  const u=new URL(pageURL);
  const action=auth.actions.find(a=>a.type===step.type&&a.pagePath===u.pathname&&u.origin===auth.origin&&canonical(a.target)===canonical(step.target));
  if(!action)stop('action-not-authorized','该控件操作不属于本轮已确认范围，未执行');
  if(action.effects.some(e=>!auth.allowedEffects.includes(e)))stop('outside-scope','该步骤包含本次范围外的作用，未发起；不能保证阻止被测产品内部联动');
  if(action.effects.some(e=>['publish','delete-original'].includes(e))&&(!action.explicitApproval?.object||!action.explicitApproval?.attribute||!Number.isSafeInteger(action.maxInvocations)))stop('explicit-approval-required','该操作可能公开发布或删除原始资料，缺少针对具体对象和次数的明确授权');
  return action;
 }
 async function begin(action){
  const token=await transaction(state=>{
   assertActive(state);
   if(action.effects.some(e=>!['observe','input'].includes(e))&&state.actions.some(x=>x.state==='pending'&&x.sessionId!==sessionId&&x.effects.some(e=>!['observe','input'].includes(e))))stop('pending-action','原任务存在结果未确认的业务动作，不能重新提交；先核对原任务');
   const count=state.actions.filter(x=>x.actionId===action.id).length;
   if(count>=(action.maxInvocations??Infinity))stop('action-limit','已达到本轮授权动作次数，未发起下一次');
   const amount=action.cost?.upperMinor||0;
   if(amount&&(!auth.budget||state.heldMinor+amount>state.limitMinor))stop('budget-exhausted','本轮剩余额度不足，未发起下一次收费操作；已有证据保留');
   const token={id:crypto.randomUUID(),sessionId,actionId:action.id,effects:action.effects,heldMinor:amount,state:'pending',startedAt:new Date().toISOString()};
   state.heldMinor+=amount;state.actions.push(token);return token;
  });
  active={...token,requests:new Map()};return token;
 }
 async function finish(token){
  if(!token)return;
  await transaction(state=>{const row=state.actions.find(x=>x.id===token.id);row.state='observed-complete';row.completedAt=new Date().toISOString();},40);
  // Completion is not a billing receipt: the upper-bound reservation is retained.
 }
 function checkRequest(request,headers={}){
  const current=snapshot();
  // Pausing does not cancel a request that belongs to an already-dispatched action.
  // Revocation/end still reject new requests from that action.
  if(current.control.status!=='paused')assertActive(current);
  else if(!active)assertActive(current);
  const url=new URL(request.url());
  if(!['http:','https:'].includes(url.protocol))return;
  const method=request.method(),hash=bodyHash(request.postDataBuffer()||Buffer.alloc(0));
  const candidates=auth.requests.filter(r=>r.origin===url.origin&&r.method===method&&new RegExp('^(?:'+r.pathPattern+')$').test(url.pathname)&&
   (!url.search||(r.allowedQueries||[]).includes(url.search))&&r.bodyHashes.includes(hash));
  const rule=candidates.find(r=>!r.actionId||active?.actionId===r.actionId);
  if(!rule)stop('request-not-authorized','请求的目标、用途或内容不在允许范围，已阻止该浏览器请求');
  const browserHeaders=new Set(['host','connection','content-length','origin','referer','user-agent','accept-encoding','accept-language','upgrade-insecure-requests','priority']);
  for(const [name,value] of Object.entries(headers)){
   const key=name.toLowerCase();
   if(browserHeaders.has(key)||key.startsWith('sec-'))continue;
   if(key==='accept'&&value.split(',').every(x=>/^(?:\*\/\*|text\/(?:html|css)|application\/(?:xhtml\+xml|xml|signed-exchange)|image\/(?:avif|webp|apng|svg\+xml|\*))(?:;\s*(?:q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)|v=b3))*$/.test(x.trim())))continue;
   if(key==='cache-control'&&['no-cache','max-age=0'].includes(value)||key==='pragma'&&value==='no-cache')continue;
   if(key==='content-type'&&['application/json','text/plain;charset=UTF-8','text/plain;charset=utf-8','text/plain','application/octet-stream','application/x-www-form-urlencoded'].includes(value))continue;
   if(!rule.headerHashes?.[key]?.includes(bodyHash(value)))stop('request-not-authorized','请求包含未经允许的认证或自定义头（'+key+'），已阻止发送');
  }
  if(rule.actionId){
   const n=(active.requests.get(rule.id)||0)+1;
   if(n>(rule.maxPerAction??1))stop('request-limit','单次动作发起的请求超过已审核数量，已阻止后续请求');
   active.requests.set(rule.id,n);
   requestTokens.set(request,{tokenId:active.id,actionId:active.actionId,requestId:rule.id});
  }
 }
 return {checkAction,begin,finish,checkRequest,captureResponse,queryPending,clearActive:()=>{active=null;},snapshot,assertActive,control,claimWorker,progress,releaseWorker,authorization:auth};
}
