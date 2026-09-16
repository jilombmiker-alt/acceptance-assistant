import {bodyHash,validateAuthorization} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {redactText,sanitize} from '../lib/privacy.mjs';
import {validatePlan} from '../v2/plan-validation.mjs';
import {dimensions} from './planner.mjs';

export const projectContractFile='acceptance.spec.json';
export const projectContractMode='project-contract';
export const projectContractLimits='项目内验收契约：执行项目明确提供的静态网页业务路径；支持同源页面、填写、选择、点击、刷新、JSON 下载和确定性结果检查。后端、收费、发布、删除、任意文件内容与主观质量仍需专用适配器。';
const must=(ok,message)=>{if(!ok)throw Error(message);};
const text=(value,max=500)=>typeof value==='string'&&value.trim()&&value.length<=max&&redactText(value)===value;
const allowedStep=new Set(['goto','fill','click','select','reload','download']);
const allowedCheck=new Set(['text','containsText','count','visible','value','overflow','json']);
const effectFor=type=>type==='fill'?'input':type==='download'?'export':['click','select'].includes(type)?'test-write':'observe';
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function exactKeys(value,allowed,message){must(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key)),message);}
function target(value){
 exactKeys(value,['label','role','name','testId','css'],'控件定位含不支持字段');
 const kinds=['label','role','testId','css'].filter(key=>Object.hasOwn(value,key));
 must(kinds.length===1&&text(value[kinds[0]],240),'控件定位必须且只能使用 label、role、testId 或 css 之一');
 if(kinds[0]==='role')must(text(value.name,240),'role 定位必须提供 name');else must(value.name===undefined,'只有 role 定位可提供 name');
 return structuredClone(value);
}

export async function loadProjectContract(root,intake){
 const row=intake?.files?.find(file=>file.file===projectContractFile);
 if(!row)return null;
 const bytes=await readReportFile(root,projectContractFile,{maxBytes:128000});
 must(bodyHash(bytes)===row.sha256,'验收契约与扫描版本不一致，请重新读取项目');
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('acceptance.spec.json 不是有效 JSON');}
 exactKeys(value,['schemaVersion','project','goal','completeContract','paths'],'验收契约包含不支持字段');
 must(value.schemaVersion===1&&text(value.project,120)&&text(value.goal,1000)&&value.completeContract===true,'验收契约需提供 schemaVersion=1、项目名、目标，并明确 completeContract=true');
 must(Array.isArray(value.paths)&&value.paths.length>0&&value.paths.length<=40,'验收契约需包含 1–40 条业务路径');
 return {value,bytes,hash:bodyHash(bytes)};
}

export async function compileProjectContractTask({id,revision=1,intake,observation,normalRuns=2,excludedPaths=[],userGoal=''}){
 must([2,3].includes(normalRuns),'项目验收契约支持 2 或 3 次正常验证');
 must(typeof userGoal==='string'&&userGoal.length<=2000&&redactText(userGoal)===userGoal,'当前目标过长或包含疑似凭据');
 const loaded=await loadProjectContract(intake.root,intake);must(loaded,'项目未提供 acceptance.spec.json');
 const spec=loaded.value,base=new URL(observation.url),allIds=new Set();
 must(Array.isArray(excludedPaths),'移除范围格式无效');
 const all=spec.paths.map((raw,index)=>{
  exactKeys(raw,['id','name','dimension','trigger','basis','dependsOn','steps','checks'],'验收路径包含不支持字段');
  must(/^[a-z0-9-]{1,80}$/.test(raw.id||'')&&!allIds.has(raw.id),'验收路径 ID 无效或重复');allIds.add(raw.id);
  must(text(raw.name,200)&&text(raw.trigger,500)&&dimensions.includes(raw.dimension),'验收路径缺少名称、触发方式或有效维度');
  must(Array.isArray(raw.basis)&&raw.basis.length&&raw.basis.length<=8&&raw.basis.every(item=>text(item,500)),'验收路径需提供 1–8 条依据');
  must(Array.isArray(raw.dependsOn||[])&&(raw.dependsOn||[]).length<=20,'验收路径依赖无效');
  must(Array.isArray(raw.steps)&&raw.steps.length&&raw.steps.length<=60&&Array.isArray(raw.checks)&&raw.checks.length&&raw.checks.length<=60,'验收路径步骤或检查数量无效');
  const steps=raw.steps.map(step=>{
   exactKeys(step,['type','path','target','value','as','description'],'验收步骤包含不支持字段');must(allowedStep.has(step.type),'验收契约包含不支持操作');
   const next={type:step.type};
   if(step.type==='goto'){
    must(typeof step.path==='string'&&step.path.length<=500,'页面路径无效');const url=new URL(step.path,base);must(url.origin===base.origin&&!url.username&&!url.password,'页面路径必须属于当前项目');next.path=url.href;
   }else if(step.type==='reload'){
    // Reload is tied to the current page and has no target.
   }else{
    next.target=target(step.target);
    if(['fill','select'].includes(step.type)){must(typeof step.value==='string'&&step.value.length<=500&&redactText(step.value)===step.value,'测试输入无效或包含疑似凭据');next.value=step.value;}
    if(step.type==='download'){must(/^[a-z0-9-]{1,60}$/.test(step.as||''),'下载产物编号无效');next.as=step.as;}
   }
   if(step.description!==undefined){must(text(step.description,300),'操作说明无效');next.description=step.description;}
   return next;
  });
  const checks=raw.checks.map(check=>{
   exactKeys(check,['type','target','expected','artifact','field','width','label'],'验收检查包含不支持字段');must(allowedCheck.has(check.type)&&text(check.label,300),'验收检查类型或说明无效');
   const encoded=JSON.stringify(check.expected);must(encoded!==undefined&&encoded.length<=4000&&redactText(encoded)===encoded,'验收预期过长或包含疑似凭据');const next={type:check.type,expected:structuredClone(check.expected),label:check.label};
   if(!['json','overflow'].includes(check.type))next.target=target(check.target);
   if(check.type==='json'){
    must(/^[a-z0-9-]{1,60}$/.test(check.artifact||''),'JSON 检查缺少下载产物编号');next.artifact=check.artifact;
    if(check.field!==undefined){must(typeof check.field==='string'&&check.field.length<=200,'JSON 字段路径无效');next.field=check.field;}
   }
   if(check.type==='overflow'){must(check.expected===false&&Number.isSafeInteger(check.width)&&check.width>=320&&check.width<=1920,'页面溢出检查无效');next.width=check.width;}
   return next;
  });
  return {id:raw.id,name:raw.name,dimension:raw.dimension,location:observation.url,trigger:raw.trigger,basis:raw.basis,dependsOn:raw.dependsOn||[],steps,checks,contractOrder:index};
 });
 must(excludedPaths.every(id=>allIds.has(id)),'移除的检查不属于项目验收契约');
 for(const path of all)must(path.dependsOn.every(id=>allIds.has(id)),'验收路径引用未知依赖');
 const excluded=new Set(excludedPaths);let changed=true;
 while(changed){changed=false;for(const item of all)if(!excluded.has(item.id)&&item.dependsOn.some(id=>excluded.has(id))){excluded.add(item.id);changed=true;}}
 const plan={project:spec.project,goal:spec.goal,planSource:projectContractFile,policy:{normalRuns,failureExtraRetries:0,recoveryAttempts:1,actionTimeoutMs:3000},paths:all.filter(item=>!excluded.has(item.id))};
 if(plan.paths.length)validatePlan(plan,{baseURL:observation.url});
 const actions=[],byKey=new Map();let pagePath=base.pathname;
 const ordered=(id,seen=new Set())=>{if(seen.has(id))return [];seen.add(id);const item=all.find(path=>path.id===id);return [...item.dependsOn.flatMap(dep=>ordered(dep,seen)),item];};
 for(const destination of plan.paths)for(const item of ordered(destination.id))for(const step of item.steps){
  if(step.type==='goto'){pagePath=new URL(step.path).pathname;continue;}
  if(!['fill','click','select','reload','download'].includes(step.type))continue;
  const key=JSON.stringify([step.type,step.target||null,pagePath]);let action=byKey.get(key);
  if(!action){action={id:'contract-'+actions.length,type:step.type,...(step.target?{target:step.target}:{}),pagePath,effects:[effectFor(step.type)],maxInvocations:0,description:step.description||step.type};actions.push(action);byKey.set(key,action);}action.maxInvocations+=normalRuns;
 }
 const requests=[...observation.readRules],known=new Set(requests.map(rule=>rule.origin+' '+rule.method+' '+rule.pathPattern));
 for(const file of intake.files){const pathname='/'+file.file.split('/').map(encodeURIComponent).join('/'),key=base.origin+' GET '+escapeRegExp(pathname);if(known.has(key))continue;known.add(key);requests.push({id:'contract-read-'+requests.length,method:'GET',origin:base.origin,pathPattern:escapeRegExp(pathname),bodyHashes:[bodyHash('')]});}
 const proposedScope={schemaVersion:1,id,project:spec.project,origin:base.origin,source:'项目验收契约仅定义候选操作；待用户在当前任务明确开始，不继承旧授权',allowedEffects:['observe','input','test-write','export'],actions,requests};
 validateAuthorization(proposedScope,observation.url,spec.project);
 const checks=all.map(item=>({id:item.id,module:item.name,dimension:dimensions.indexOf(item.dimension),basis:item.basis,expected:item.checks.map(check=>check.label+'：'+JSON.stringify(check.expected)).join('；'),status:excluded.has(item.id)?'outside-scope':'planned',source:{kind:'project-contract',file:projectContractFile}}));
 const coverage=checks.flatMap(check=>dimensions.map((dimension,index)=>({module:check.module,dimension,status:excluded.has(check.id)?'outside-scope':check.dimension===index?'planned':'not-applicable',reason:excluded.has(check.id)?'本轮移除，或其前置路径已移除':check.dimension===index?check.expected:'项目验收契约未把此路径归入该维度',checkIds:check.dimension===index?[check.id]:[]})));
 const materials=[{file:projectContractFile,line:1,excerpt:'项目声明的完整业务验收契约；系统已校验结构和可执行范围'}];
 const gaps=[...(intake.gaps||[]).filter(reason=>!reason.startsWith('未找到明确目标')).map(reason=>({kind:'intake',reason})),{kind:'contract-boundary',reason:'系统可完整执行项目声明的契约，但无法仅凭项目自述证明契约覆盖了所有真实业务要求；后端、外部服务和主观质量仍需独立适配与答案。'}];
 const task={id,revision,mode:projectContractMode,goal:userGoal.trim()?userGoal.trim()+'；契约目标：'+spec.goal:spec.goal,endpoint:'完成项目验收契约中本轮保留的全部路径及结果核对后结束',expectedText:'',normalRuns,fieldValues:{},excludedPaths:[...excluded],sources:{current:{kind:'project-contract',text:spec.goal,revision},materials,historyPolicy:'项目契约与当前明确目标优先；历史只作为有来源的候选，不改变契约预期'},fingerprint:intake.fingerprint,fingerprintScope:intake.fingerprintScope,templateHash:loaded.hash,contract:{file:projectContractFile,hash:loaded.hash,declaredComplete:true,pathCount:all.length,userGoal:userGoal.trim()},checks,coverage,gaps,plan,proposedScope,limitations:projectContractLimits};
 task.digest=bodyHash(JSON.stringify(task));return sanitize(task);
}
