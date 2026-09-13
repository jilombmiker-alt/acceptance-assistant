import {OMITTED_INPUT} from '../lib/privacy.mjs';

// Engine capacity ceilings, not product performance SLAs or spending approval.
export const PLAN_LIMITS = Object.freeze({paths:200,steps:500,checks:500,normalRuns:100,operations:100000,waitMs:43200000});
const text = x => typeof x === 'string' && x.trim().length > 0;
const requireValue = (ok,message) => {if(!ok)throw Error(message);};
const integer = (x,min,max) => Number.isSafeInteger(x)&&x>=min&&x<=max;
const actions = new Set(['goto','fill','click','select','reload','wait','download']);
export function validateTarget(target){
 requireValue(target&&typeof target==='object'&&!Array.isArray(target),'缺少控件定位依据');
 const kinds=['label','role','testId','css'].filter(k=>Object.hasOwn(target,k));
 requireValue(kinds.length===1&&text(target[kinds[0]]),'控件定位必须提供一种明确方式');
 requireValue(Object.keys(target).every(k=>k===kinds[0]||(kinds[0]==='role'&&k==='name')),'控件定位含不支持的字段');
 if(kinds[0]==='role')requireValue(text(target.name),'角色定位缺少名称');
}
export function validatePlan(plan,{baseURL}={}){
 requireValue(plan&&text(plan.goal)&&Array.isArray(plan.paths)&&plan.paths.length>0,'计划缺少目标或路径');
 requireValue(plan.paths.length<=PLAN_LIMITS.paths,'计划路径超过执行器容量上限');
 const policy=plan.policy;
 requireValue(policy&&integer(policy.normalRuns,2,PLAN_LIMITS.normalRuns)&&integer(policy.failureExtraRetries,0,5),'重复验证配置无效或超过执行器容量上限');
 for(const [key,min,max] of [['controlWaitMs',100,PLAN_LIMITS.waitMs],['actionTimeoutMs',50,30000],['recoveryAttempts',0,3]])if(policy[key]!==undefined)requireValue(integer(policy[key],min,max),'等待或恢复配置无效：'+key);
 const paths=new Map();
 for(const p of plan.paths){
  requireValue(p&&/^[a-z0-9-]+$/.test(p.id||'')&&!paths.has(p.id),'路径 ID 无效或重复');paths.set(p.id,p);
  requireValue(text(p.name)&&text(p.location)&&text(p.trigger)&&Array.isArray(p.basis)&&p.basis.length&&p.basis.every(text)&&Array.isArray(p.checks)&&p.checks.length,'路径缺少可追溯依据或最终结果检查：'+p.id);
  requireValue(Array.isArray(p.steps)&&p.steps.length<=PLAN_LIMITS.steps&&p.checks.length<=PLAN_LIMITS.checks,'步骤或检查数量无效');
  requireValue(p.dependsOn===undefined||Array.isArray(p.dependsOn)&&p.dependsOn.every(text)&&new Set(p.dependsOn).size===p.dependsOn.length,'路径依赖无效');
  for(const s of p.steps){
   requireValue(s&&actions.has(s.type),'不支持的操作');
   requireValue(!s.valueOmitted&&s.value!==OMITTED_INPUT,'脱敏运行快照不能直接重放；请使用原计划或重新提供输入引用');
   if(!['goto','reload'].includes(s.type))validateTarget(s.target);
   if(s.type==='goto'){
    requireValue(typeof s.path==='string','跳转缺少明确路径');
    const u=new URL(s.path||baseURL||'/',baseURL||'http://127.0.0.1');
    requireValue(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'跳转地址无效');
    if(baseURL)requireValue(u.origin===new URL(baseURL).origin,'跳转超出被测项目');
   }
   if(s.documentURL!==undefined){const u=new URL(s.documentURL,baseURL);requireValue(['click','download'].includes(s.type)&&u.origin===new URL(baseURL).origin&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname.endsWith('.json')&&typeof s.newWindow==='boolean','证据跳转超出明确的同源 JSON 文档范围');}
   if(s.type==='fill')requireValue(s.inputRef!==undefined?/^[A-Z_][A-Z0-9_]*$/.test(s.inputRef)&&s.value===undefined:typeof s.value==='string','填写内容或输入引用无效');
   if(s.type==='select')requireValue(typeof s.value==='string','选择值无效');
   if(s.type==='download')requireValue(/^[a-z0-9-]+$/i.test(s.as||''),'导出标识无效');
   if(s.type==='wait'){
    requireValue(integer(s.budgetMs,1,PLAN_LIMITS.waitMs)&&integer(s.pollMs,1,30000),'等待预算或轮询间隔无效');
    requireValue(text(s.attribute)&&Array.isArray(s.successValues)&&s.successValues.length&&s.successValues.every(text),'等待条件不完整');
    requireValue(s.failureValues===undefined||Array.isArray(s.failureValues)&&s.failureValues.every(text),'失败终态无效');
    requireValue(!(s.failureValues||[]).some(v=>s.successValues.includes(v)),'等待成功与失败终态冲突');
    if(s.refresh)validateTarget(s.refresh);
   }
  }
  for(const c of p.checks){
   requireValue(c&&['text','containsText','count','json','visible','value','overflow','documentJSON'].includes(c.type)&&Object.hasOwn(c,'expected')&&c.expected!==undefined,'不支持或不完整的结果检查');
   if(!['json','overflow','documentJSON'].includes(c.type))validateTarget(c.target);
   if(c.type==='visible')requireValue(typeof c.expected==='boolean','可见性预期必须是布尔值');
   if(c.type==='value')requireValue(typeof c.expected==='string','输入值预期必须是字符串');
   if(c.type==='containsText')requireValue(text(c.expected),'需要明确的包含文字预期');
   if(c.type==='overflow')requireValue(c.expected===false&&integer(c.width,320,1920),'页面溢出检查配置无效');
   if(c.type==='text')requireValue(typeof c.expected==='string','文字预期必须是字符串');
   if(c.type==='count')requireValue(integer(c.expected,0,Number.MAX_SAFE_INTEGER),'数量预期无效');
   if(c.type==='json')requireValue(text(c.artifact)&&(c.field===undefined||typeof c.field==='string'),'产物引用无效');
  }
 }
 const seen=new Set(),stack=new Set(),ordered=new Map();
 function visit(id){
  requireValue(!stack.has(id),'路径依赖成环');if(seen.has(id))return ordered.get(id);
  const p=paths.get(id);requireValue(p,'未知依赖：'+id);stack.add(id);const dependencies=new Set();
  for(const dep of p.dependsOn||[])for(const item of visit(dep))dependencies.add(item);
  dependencies.add(id);stack.delete(id);seen.add(id);ordered.set(id,dependencies);return dependencies;
 }
 let operations=0;
 for(const p of plan.paths){
  const available=new Set();let hasPage=false;
  for(const id of visit(p.id)){
   const source=paths.get(id);
   operations+=(source.steps.length+source.checks.length)*(policy.normalRuns+policy.failureExtraRetries);
   requireValue(operations<=PLAN_LIMITS.operations,'依赖展开后的执行总量超过容量上限');
   for(const s of source.steps){
    if(s.type==='goto')hasPage=true;
    requireValue(hasPage,'路径缺少先行页面入口：'+p.id);
    if(s.type==='download'){requireValue(!available.has(s.as),'产物编号在依赖链中重复：'+s.as);available.add(s.as);}
   }
   for(const c of source.checks){
    if(c.type==='json')requireValue(available.has(c.artifact),'检查引用尚未产生的产物：'+c.artifact);
    else requireValue(hasPage,'结果检查缺少页面入口：'+p.id);
   }
  }
 }
 return true;
}
