import {sanitize, sensitiveTarget, OMITTED_INPUT} from '../lib/privacy.mjs';
import {screenshotProtection} from '../lib/screenshot-privacy.mjs';
import {createRunDirectory} from '../lib/run-directory.mjs';
import {createAuthorizationGuard,PermissionStop,bodyHash} from '../lib/authorization.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {isDeepStrictEqual} from 'node:util';import {browserEngine} from '../lib/browser.mjs';
import {repeatPath} from './repetition.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {validatePlan} from './plan-validation.mjs';
export {validatePlan} from './plan-validation.mjs';
function locator(page,spec){if(spec.label)return page.getByLabel(spec.label,{exact:true});if(spec.role)return page.getByRole(spec.role,{name:spec.name,exact:true});if(spec.testId)return page.getByTestId(spec.testId);if(spec.css)return page.locator(spec.css);throw Error('缺少控件定位依据')}
function field(obj,key){if(!key)return obj;return key.split('.').reduce((v,k)=>v?.[k],obj)}
export async function executePlan({baseURL,plan,out,intake,inputs={},authorization,authorizationStore,managed=false,resumeFrom,scopeControl}){
validatePlan(plan,{baseURL});if(plan.history?.gaps?.length)throw Error('历史条件尚未完成对应：'+plan.history.gaps.map(g=>g.reason).join('；'));const knownSecrets=new Set(),inputValues=[];
for(const p of plan.paths)for(const s of p.steps||[])if(s.type==='fill'){
 const value=s.inputRef?inputs[s.inputRef]:s.value;
 if(typeof value!=='string')throw Error('缺少填写内容或输入引用：'+(s.inputRef||p.id));
 inputValues.push(value);if(s.sensitive||s.inputRef||sensitiveTarget(s.target))knownSecrets.add(value);
}
const clean=data=>sanitize(data,{secrets:knownSecrets,omitInputs:true});
const save=async(file,data)=>{const target=path.join(out,file),temp=target+'.next';await fs.writeFile(temp,JSON.stringify(clean(data),null,2),{mode:0o600});await fs.rename(temp,target);};
const guard=await createAuthorizationGuard({authorization,baseURL,project:plan.project,storeDir:authorizationStore});
const identity=bodyHash(JSON.stringify({baseURL,plan,inputs}));
let prior=null;
if(resumeFrom){
 const saved=JSON.parse(await readReportFile(resumeFrom,'execution-identity.json'));
 if(saved.hash!==identity||saved.authorizationId!==authorization.id)throw Error('恢复计划、输入或授权与原任务不一致，未重放');
 const bytes=await readReportFile(resumeFrom,'checkpoint.json');
 const ledger=guard.snapshot();
 if(ledger.worker?.runId!==resumeFrom||ledger.worker.checkpointHash!==bodyHash(bytes))throw Error('检查点与原任务保存记录不一致，不能继续');
 prior=JSON.parse(bytes);
 if(ledger.actions.some(a=>a.state==='pending'&&a.effects.some(e=>!['input','observe'].includes(e))))throw Error('原任务仍有结果未确认的业务动作，先查询原任务，不能从头重放');
 for(const group of prior.groups){
  const last=group.records?.at(-1);
  if(last?.status==='unverified'&&(last.authorizationTokens||[]).some(t=>t.effects.some(e=>!['input','observe'].includes(e))))throw Error('中断发生在已提交业务动作之后；目前没有安全接续位置，已保留原结果，不能重放');
 }
}
out=await createRunDirectory(out);
await save('execution-identity.json',{hash:identity,authorizationId:authorization.id});
if(prior){
 await save('recovery-source.json',{from:resumeFrom,originalCheckpoint:prior});
 for(const group of prior.groups)for(const record of group.records||[]){
  const files=[record.id+'.json',...(record.snapshots||[]).map(x=>x.file),...(record.outputs||[])];
  for(const file of new Set(files)){const data=await readReportFile(resumeFrom,file);const destination=path.join(out,'previous',file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,data,{flag:'wx',mode:0o600});}
  record.id='previous/'+record.id;
  for(const snapshot of record.snapshots||[])snapshot.file='previous/'+snapshot.file;
  record.outputs=(record.outputs||[]).map(x=>'previous/'+x);
 }
}
await save('plan.json',sanitize(plan,{secrets:inputValues,omitInputs:true}));await save('authorization.json',guard.authorization);if(intake)await save('intake.json',intake);
if(managed)await guard.claimWorker({runId:out,planHash:identity});
const origin=new URL(baseURL).origin;let browser;try{browser=await(await browserEngine()).launch({headless:true});}catch(error){if(managed)await guard.releaseWorker('interrupted');throw error;}const groups=[],events=[];let chain=Promise.resolve();
const log=(event)=>{const row=clean({at:new Date().toISOString(),...event});events.push(row);chain=chain.then(()=>fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600}));};
async function checkpoint(data){await save('checkpoint.json',data);if(managed)await guard.progress({checkpointHash:bodyHash(JSON.stringify(clean(data),null,2))});}
async function gate(detail){
 const start=Date.now();let phase;
 for(;;){
  const state=guard.snapshot();
  if(scopeControl?.(detail?.pathId||state.worker?.pathId)?.excluded)throw new PermissionStop('scope-reduced','本路径已从本次范围移除，保留已经发生的操作和证据');
  if(state.control.skipPathId&&state.control.skipPathId===(detail?.pathId||state.worker?.pathId))throw new PermissionStop('path-skipped','用户跳过当前路径，已保留证据；独立路径继续');
  if(state.control.status==='active'){if(managed)await guard.progress({phase:'running',...detail});return Date.now()-start;}
  if(state.control.status!=='paused')guard.assertActive(state);
  if(phase!=='paused'){phase='paused';if(managed)await guard.progress({phase,...detail});}
  if(Date.now()-start>(plan.policy.controlWaitMs??1800000))throw new PermissionStop('control-timeout','等待继续超过本次控制等待期限，保留证据和原任务');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
async function beginControlled(action){
 const started=Date.now();
 for(;;){
  await gate({actionId:action.id});
  try{return await guard.begin(action);}catch(error){
   if(error.code==='task-paused')continue;
   if(!managed||error.code!=='budget-exhausted')throw error;
   await guard.progress({phase:'awaiting-budget',actionId:action.id});
   if(Date.now()-started>(plan.policy.controlWaitMs??1800000))throw new PermissionStop('control-timeout','等待追加额度超过本次控制等待期限，未发起收费动作');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
}
function ordered(id,used=new Set()){if(used.has(id))return [];const p=plan.paths.find(x=>x.id===id);const list=[];for(const dep of p.dependsOn||[])list.push(...ordered(dep,used));if(!used.has(id)){used.add(id);list.push(p)}return list}
async function attempt(target,index){const context=await browser.newContext({viewport:{width:1200,height:850},acceptDownloads:true,serviceWorkers:'block'});guard.clearActive();const violations=[],tokens=[],receipts=[];context.on('response',response=>{const promise=guard.captureResponse(response).catch(error=>violations.push({code:error.code||'receipt-error',reason:error.message}));receipts.push(promise);});await context.route('**/*',async route=>{try{guard.checkRequest(route.request(),await route.request().allHeaders());return await route.continue();}catch(e){violations.push({code:e.code||'network-error',reason:e.message});await route.abort().catch(()=>{});}});await context.routeWebSocket('**/*',ws=>{violations.push({code:'websocket-not-supported',reason:'尚未授权此WebSocket通道，未建立连接'});ws.close();});let page=await context.newPage();page.setDefaultTimeout(plan.policy.actionTimeoutMs||5000);const name=target.id+'-'+index;const r={id:name,pathId:target.id,attempt:index+1,startedAt:new Date().toISOString(),status:'unverified',checks:[],actions:[],snapshots:[],outputs:[],consoleErrors:[],recoveries:[],inputs:[],outputProtection:[],permissionEvents:violations};const artifacts={},sensitiveControls=[];const started=Date.now();page.on('pageerror',e=>r.consoleErrors.push(e.message));
const authorize=async step=>{const action=guard.checkAction(step,page.url());const control=step.target?await prepare(step.target,step.type):null;if(action.explicitApproval&&await control.getAttribute(action.explicitApproval.attribute)!==action.explicitApproval.object)throw new PermissionStop('object-mismatch','当前操作对象与已授权对象不一致，未执行');const token=await beginControlled(action);tokens.push(token);r.authorizationTokens=tokens;if(r.actions.length)r.actions.at(-1).dispatchState='dispatched';return control;};
const snap=async phase=>{
 const f=name+'-'+r.snapshots.length+'.png';r.snapshotProtection??=[];
 try{
  const protection=await screenshotProtection(page,{knownSecrets,sensitiveControls});
  const image=await page.screenshot({fullPage:true,mask:protection.masks,timeout:10000});
  await fs.writeFile(path.join(out,f),image,{flag:'wx',mode:0o600});
  r.snapshots.push({file:f,phase});r.snapshotProtection.push({phase,file:f,status:'protected',policy:protection.policy,limitations:protection.limitations});
 }catch(error){r.snapshotProtection.push({phase,status:'omitted',reason:'截图保护未完成，未保留图片：'+error.message});}
 const controls=await page.locator('a,button,input,select').evaluateAll(es=>es.map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.labels?.[0]?.textContent?.trim()||e.textContent?.trim(),href:e.getAttribute('href'),disabled:e.disabled||false})));
 await save(name+'-controls-'+r.snapshots.length+'.json',{url:page.url(),phase,controls});
};

// Recovery only repeats read-only locator observation before dispatching an action.
// An action that may already have happened is never replayed after a timeout.
async function prepare(spec, phase) {
 const budget=plan.policy.recoveryAttempts??2;
 for(let n=0;;n++){
  try {const loc=locator(page,spec);await loc.waitFor({state:'visible'});return loc;}
  catch(e){
   if(!/Timeout|strict mode violation/.test(e.message)||n>=budget)throw e;
   const recovery={phase,attempt:n+1,strategy:'重新观察同一控件，不执行点击或重新提交',error:e.message};
   r.recoveries.push(recovery);log({path:target.id,type:'recovery',...recovery});
   await snap('recovery-'+phase).catch(()=>{});
  }
 }
}
try{for(const p of ordered(target.id)){
for(const [stepIndex,s] of p.steps.entries()){
 await gate({pathId:target.id,attempt:index+1,step:stepIndex,action:s.type});
 if(violations.length)throw new PermissionStop(violations[0].code,violations[0].reason);
 const a={pathId:p.id,setup:p.id!==target.id,step:stepIndex,type:s.type,dispatchState:'not-dispatched',label:s.description||s.target?.name||s.target?.label||s.path||s.type};r.actions.push(a);log({path:target.id,attempt:index+1,type:'action',...a});
 if(s.type==='goto'){const u=s.path===''?new URL(baseURL.replace(/\/$/,'')):new URL(s.path,baseURL);if(u.origin!==origin)throw Error('跳转超出被测项目');a.dispatchState='dispatched';await page.goto(u.href);await snap(p.id+'-entry')}
 else if(s.type==='fill'){
 const control=await authorize(s);const value=s.inputRef?inputs[s.inputRef]:s.value;
 const metadata=await control.evaluate(e=>({type:e.type,name:e.name,autocomplete:e.autocomplete,label:e.getAttribute('aria-label')}));
 const sensitive=!!(s.sensitive||s.inputRef||sensitiveTarget(s.target)||sensitiveTarget(metadata));
 if(sensitive){knownSecrets.add(value);sensitiveControls.push(control);}
 r.inputs.push({pathId:p.id,step:stepIndex,target:s.target,sensitive,value:sensitive?OMITTED_INPUT:value});
 await control.fill(value);
 }
 else if(s.type==='click'){
 const control=await authorize(s);
 if(s.documentURL){const href=await control.getAttribute('href');if(new URL(href,page.url()).href!==s.documentURL)throw new PermissionStop('document-changed','证据链接已变化，本轮未沿用旧目标');
 if(s.newWindow){const [popup]=await Promise.all([context.waitForEvent('page',{timeout:plan.policy.actionTimeoutMs||5000}),control.click()]);page=popup;page.setDefaultTimeout(plan.policy.actionTimeoutMs||5000);await page.waitForLoadState('domcontentloaded');}else{await Promise.all([page.waitForURL(s.documentURL),control.click()]);}
 if(page.url()!==s.documentURL)throw new PermissionStop('document-redirected','证据链接未落到选定文档，本轮未验证');
 }else await control.click();
 }
 else if(s.type==='select')await (await authorize(s)).selectOption(s.value);
 else if(s.type==='reload'){await authorize(s);await page.reload();}
 else if(s.type==='wait'){
 let t=Date.now();let matched=false,terminal=false;while(Date.now()-t<s.budgetMs){
  t+=await gate({pathId:target.id,attempt:index+1,step:stepIndex,action:'wait'});
  if(violations.length)throw new PermissionStop(violations[0].code,violations[0].reason);if(s.refresh)await (await authorize({type:'click',target:s.refresh})).click();const value=await locator(page,s.target).getAttribute(s.attribute);if((s.failureValues||[]).includes(value)){terminal=true;break}if((s.successValues||[]).includes(value)){matched=true;break}await page.waitForTimeout(Math.min(s.pollMs,s.budgetMs-(Date.now()-t)))}
 if(terminal){r.status=p.id===target.id?'issue':'blocked';r.reason='任务明确失败，未取得预期结果';r.failedAt=p.id;await snap('explicit-failure');return r}if(!matched){r.status='unverified';r.reason='等待预算耗尽，本轮未确认完成';await snap('wait-budget');return r}}
 else if(s.type==='download'){const control=await authorize(s);if(s.documentURL&&new URL(await control.getAttribute('href'),page.url()).href!==s.documentURL)throw new PermissionStop('document-changed','下载链接已变化，本轮未沿用旧目标');const [dl]=await Promise.all([page.waitForEvent('download'),control.click()]);const f=name+'-'+s.as+'.json';if(!/^[a-z0-9-]+$/i.test(s.as))throw Error('导出标识无效');
 const stream=await dl.createReadStream();if(!stream)throw Error('无法读取下载内容');const chunks=[];let bytes=0;
 for await(const chunk of stream){bytes+=chunk.length;if(bytes>10*1024*1024){stream.destroy();throw Error('下载超过本轮10MiB读取预算，未完成验证')}chunks.push(chunk);}
 const raw=Buffer.concat(chunks).toString('utf8');
 try{artifacts[s.as]=JSON.parse(raw)}catch{await fs.writeFile(path.join(out,f),clean(raw),{mode:0o600});r.outputs.push(f);r.outputProtection.push({file:f,redacted:clean(raw)!==raw});r.status=p.id===target.id?'issue':'blocked';r.reason='下载结果无法按要求读取为 JSON';await snap('invalid-output');return r}
 const protectedOutput=clean(artifacts[s.as]);await save(f,protectedOutput);r.outputs.push(f);r.outputProtection.push({file:f,redacted:JSON.stringify(protectedOutput)!==JSON.stringify(artifacts[s.as])})}
}
await snap(p.id+'-result');
let failed=false,incomplete=false;
for(const c of p.checks){
 await gate({pathId:target.id,attempt:index+1,action:'check'});
 if(violations.length)throw new PermissionStop(violations[0].code,violations[0].reason);
 let actual,pass=null,error,documentReadable=true;
 try{
  if(c.type==='documentJSON'){try{actual=JSON.parse(await page.locator('body').innerText());}catch{actual=null;documentReadable=false;}}
  else if(c.type==='json')actual=field(artifacts[c.artifact],c.field);
  else if(c.type==='overflow'){await page.setViewportSize({width:c.width,height:850});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));actual=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);}
  else if(c.type==='visible')actual=await locator(page,c.target).isVisible();
  else if(c.type==='value')actual=await (await prepare(c.target,'result')).inputValue();
  else if(c.type==='count')actual=await locator(page,c.target).count();
  else actual=await (await prepare(c.target,'result')).innerText();
  pass=documentReadable&&(c.type==='containsText'?actual.includes(c.expected):isDeepStrictEqual(actual,c.expected));
 }catch(e){if(e instanceof PermissionStop)throw e;error=e.message;incomplete=true;}
 const result={pathId:p.id,setup:p.id!==target.id,label:c.label,expected:c.expected,actual:actual===undefined?null:actual,pass,status:error?'unverified':pass?'pass':'issue',...(error?{error}:{}),problem:c.problem,conditionRefs:c.conditionRefs||[]};
 r.checks.push(result);log({path:target.id,attempt:index+1,type:'result-check',...result});
 if(pass===false){
  failed=true;r.deviations??=[];
  const deviation={pathId:p.id,check:c.label,afterAction:r.actions.at(-1),expected:c.expected,actual:actual===undefined?null:actual};
  r.deviations.push(deviation);r.firstDeviation??=deviation;
  if(!r.reason)r.reason=c.problem||'最终结果不符合明确预期';r.failedAt=p.id;
 }
}
// Finish independent observations on this state, but never advance a failed prerequisite.
if(incomplete){r.status='unverified';r.reason='部分结果检查未完成，已保留其他独立检查及发现的问题';return r;}
if(failed){r.status=p.id===target.id?'issue':'blocked';return r;}

}if(violations.length)throw new PermissionStop(violations[0].code,violations[0].reason);r.status='pass';r.reason='本路径最终结果符合明确预期';return r;
}catch(e){r.status='unverified';r.reason=(e instanceof PermissionStop?'执行范围或预算受限：':'执行器未完成检查：')+e.message;r.firstDeviation={kind:e instanceof PermissionStop?'permission-stop':'executor-incomplete',afterAction:r.actions.at(-1),error:e.message};if(e instanceof PermissionStop)r.permissionStop={code:e.code,reason:e.message};r.error=e.stack;await snap('executor-error').catch(()=>{});return r}
finally{await Promise.all(receipts);await context.close();if(violations.length){r.status='unverified';r.reason='浏览器请求未获授权：'+violations[0].reason;r.permissionStop=violations[0];}if(!violations.length&&(['pass','issue'].includes(r.status)||r.reason==='任务明确失败，未取得预期结果'))for(const token of tokens)await guard.finish(token);r.elapsedMs=Date.now()-started;r.budget=await guard.snapshot();await save(name+'.json',r);log({path:target.id,attempt:index+1,type:'attempt-ended',status:r.status});}}
let finalized=false;
try{const order=[];const visited=new Set();for(const p of plan.paths)for(const item of ordered(p.id))if(!visited.has(item.id)){visited.add(item.id);order.push(item)}
for(const p of order){const dep=(p.dependsOn||[]).map(id=>groups.find(g=>g.path.id===id)).find(g=>g.status!=='pass');if(dep){groups.push({path:p,status:'blocked',reason:'依赖路径 '+dep.path.name+' 未通过，未执行本路径',records:[]});log({path:p.id,type:'dependency-blocked',dependency:dep.path.id});continue}
const old=prior?.groups.find(g=>g.path.id===p.id);const initialRecords=(old?.records||[]).filter(r=>['pass','issue'].includes(r.status));
const summary=await repeatPath(i=>attempt(p,i),plan.policy,{initialRecords,onRecord:async records=>{await chain;await checkpoint({goal:plan.goal,groups:[...groups,{path:p,records,status:'in-progress'}]});}});groups.push({path:p,...summary});await chain;await checkpoint({goal:plan.goal,groups});}
await chain;await browser.close();
if(managed){await guard.progress({canResume:groups.some(g=>g.records?.some(r=>r.status==='unverified'&&r.permissionStop?.code!=='path-skipped'&&!(r.authorizationTokens||[]).some(t=>t.effects.some(e=>!['input','observe'].includes(e))))) });await guard.releaseWorker('finished');}
const result={generatedAt:new Date().toISOString(),lifecycle:{phase:'finished',scope:'本轮执行已收尾，是否通过以检查结果为准'},goal:plan.goal,project:plan.project,planSource:plan.planSource,policy:plan.policy,history:plan.history||null,authorizationId:authorization.id,budget:guard.snapshot(),groups,events};
await save('results.json',result);finalized=true;return clean(result);
}finally{try{await chain;}finally{await browser.close();if(managed&&!finalized)await guard.releaseWorker('interrupted');}}}
