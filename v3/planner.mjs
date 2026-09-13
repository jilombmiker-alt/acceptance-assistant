import {bodyHash} from '../lib/authorization.mjs';
import {sanitize,redactText} from '../lib/privacy.mjs';
import {validatePlan} from '../v2/plan-validation.mjs';

export const dimensions=['业务逻辑','交互反馈','数据正确性','UI 与可用性','权限与隐私','信息安全与可靠性','性能'];
export const plannerLimits='本机基础规划：支持入口、明确文字、普通输入回读、屏幕溢出，以及已识别的详情和项目内 JSON 证据。复杂业务、生成、任意格式产物与主观内容质量仍需专门检查。';
const has=(s,re)=>re.test(s);
const excluded=(goal,word)=>new RegExp('(?:不检查|不验|不需要|不用|排除|跳过)[^，。；\n]{0,6}'+word).test(goal);
export function compileTask({id,revision=1,goal,endpoint='',expectedText='',normalRuns=2,intake,observation,fieldValues={},excludedPaths=[]}){
 if(typeof goal!=='string'||!goal.trim()||goal.length>2000)throw Error('请填写本次目标（最多 2000 字）');
 if(typeof endpoint!=='string'||endpoint.length>500||typeof expectedText!=='string'||expectedText.length>500)throw Error('目标终点或明确文字过长');
 for(const value of [goal,endpoint,expectedText,...Object.values(fieldValues)])if(typeof value!=='string'||redactText(value)!==value)throw Error('本轮任务说明和普通测试样例不接收凭据；请移除敏感内容');
 if(!Number.isInteger(normalRuns)||normalRuns<2||normalRuns>3)throw Error('本轮入口支持约定的 2 或 3 次正常验证');
 const cleanGoal=goal.trim(),source={kind:'current-user',text:cleanGoal,revision},paths=[],checks=[];
 if(!Array.isArray(excludedPaths)||!excludedPaths.every(x=>typeof x==='string'))throw Error('检查范围格式无效');
 excludedPaths=[...excludedPaths];
 const project=observation.title||'本地项目';
 const path=(key,name,steps,assertions,dimension,basis)=>{
  const p={id:key,name,location:observation.url,trigger:steps.map(s=>s.description||'打开选定页面').join(' → '),basis,steps,checks:assertions};
  paths.push(p);checks.push({id:key,module:name,dimension,source,expected:assertions.map(c=>c.label).join('；'),basis,status:excludedPaths.includes(key)?'outside-scope':'planned'});
 };
 const entry={type:'goto',path:observation.url,description:'打开本次选定页面'};
 path('entry','页面入口',[entry],[{type:'visible',target:{css:'body'},expected:true,label:'页面主体可见（只证明入口）'}],0,['本次目标与选定入口；基础前置检查，不代表业务完成']);
 if(expectedText.trim())path('expected-text','明确文字',[entry],[{type:'containsText',target:{css:'body'},expected:expectedText.trim(),label:'页面包含本次明确要求的文字'}],0,['用户本次明确提供的文字预期']);
 const wantsInput=has(cleanGoal,/输入|填写|表单/)&&!excluded(cleanGoal,'(?:输入|填写|表单)');
 if(wantsInput)for(const [i,f] of observation.fields.entries()){
  const sample=fieldValues[f.target.css]??(f.type==='email'?'acceptance@example.invalid':f.type==='url'?'https://example.invalid/':'本轮验收样例');
  if(typeof sample!=='string'||sample.length>500)throw Error('测试输入最多 500 字');
  path('input-'+i,'输入：'+(f.name||'未命名输入框'),[entry,{type:'fill',target:f.target,value:sample,description:'填写本轮测试样例，不提交'}],[{type:'value',target:f.target,expected:sample,label:'输入框保留本次填写值'}],2,['用户目标包含输入/表单；填写后的值应与本次样例一致（基础交互规则）']);
 }
 if(has(cleanGoal,/窄屏|小屏|手机|适配|界面|UI|可用性/)&&!excluded(cleanGoal,'(?:UI|界面|适配|窄屏)'))path('layout','页面尺寸',[entry],[{type:'overflow',width:1440,expected:false,label:'桌面宽度无横向溢出'},{type:'overflow',width:390,expected:false,label:'窄屏宽度无横向溢出'}],3,['本次界面适配目标；基础可用性规则，不代表全部视觉质量']);
 if(/^(?:只|仅|先)?(?:检查|看到|到)?(?:页面)?入口(?:即可|就结束|结束|为止)?$/.test(endpoint.trim()))for(const c of checks)if(c.id!=='entry'){excludedPaths.push(c.id);c.status='outside-scope';}
 excludedPaths=[...new Set(excludedPaths)].filter(id=>checks.some(c=>c.id===id));
 const coverage=checks.flatMap(c=>dimensions.map((dimension,i)=>({module:c.module,dimension,status:c.status==='outside-scope'?'outside-scope':c.dimension===i?'planned':'unsupported',reason:c.status==='outside-scope'?'用户从本轮移除或终点限定':c.dimension===i?c.expected:'本项尚无对应验证方式，不计通过',checkIds:c.dimension===i?[c.id]:[]})));
 for(const word of ['生成','导出','视频','发布','删除','颜色','高级感','保存','刷新','空输入','必填'])if(cleanGoal.includes(word)||endpoint.includes(word)){
  const outside=excluded(cleanGoal,word),reason=outside?'本次明确排除':'当前规划器尚不能可靠对应此业务结果，需要后续能力或必要条件';
  coverage.push(...dimensions.map(dimension=>({module:word,dimension,status:outside?'outside-scope':'unsupported',reason,checkIds:[]})));
 }
 const issues=intake.gaps.filter(reason=>!reason.startsWith('未找到明确目标')).map(reason=>({kind:'intake',reason}));
 issues.push({kind:'semantic-coverage',reason:'当前仅按已支持规则对应基础检查，尚未完整理解目标和需求材料；材料中的其他业务要求不能因基础检查通过而计为通过。'});
 if(endpoint.trim()&&!/^(?:只|仅|先)?(?:检查|看到|到)?(?:页面)?入口(?:即可|就结束|结束|为止)?$/.test(endpoint.trim())&&!endpoint.startsWith('完成本次可执行检查后结束'))issues.push({kind:'endpoint',reason:'此文字终点尚不能自动对应阶段边界；请从检查清单移除范围外项。这里只执行所选基础检查，不宣称已到达该业务终点。'});
 if(!wantsInput&&!expectedText.trim()&&!has(cleanGoal,/入口|页面|界面|UI|窄屏|可用性/))issues.push({kind:'planning',reason:'本次目标的主要业务结果尚未对应；可执行入口检查仅为前置，不能满足整个目标。'});
 if(wantsInput&&!observation.fields.length)issues.push({kind:'mapping',reason:'选定入口未观察到支持的普通输入框；不猜测隐藏步骤。'});
 if(observation.blocked.length)issues.push({kind:'observation',reason:'页面存在未读取的请求或资源；页面观察可能不完整，见接入记录。'});
 const active=paths.filter(p=>!excludedPaths.includes(p.id));
 const plan={project,goal:cleanGoal,planSource:plannerLimits,policy:{normalRuns,failureExtraRetries:0,recoveryAttempts:1,actionTimeoutMs:2000},paths:active};
 if(active.length)validatePlan(plan,{baseURL:observation.url});
 const actions=[];
 for(const p of paths)for(const s of p.steps)if(s.type==='fill'&&!actions.some(a=>JSON.stringify(a.target)===JSON.stringify(s.target)))actions.push({id:'field-'+actions.length,type:'fill',target:s.target,pagePath:new URL(observation.url).pathname,effects:['input'],maxInvocations:normalRuns,description:s.description});
 const authorization={schemaVersion:1,id,project,origin:new URL(observation.url).origin,source:'待用户在本机任务入口明确开始；目标文本本身不授予操作权限',allowedEffects:['observe','input'],actions,requests:observation.readRules};
 const task={id,revision,goal:cleanGoal,endpoint:endpoint.trim()||'完成本次可执行检查后结束；未对应部分保留缺项',expectedText,normalRuns,fieldValues,excludedPaths:[...excludedPaths],sources:{current:source,materials:intake.requirements,historyPolicy:'材料仅为候选依据；旧偏好不自动成为本次要求'},fingerprint:intake.fingerprint,fingerprintScope:intake.fingerprintScope,checks,coverage,gaps:issues,plan,proposedScope:authorization,limitations:plannerLimits};
 task.digest=bodyHash(JSON.stringify(task));return sanitize(task);
}
export function coverageResults(task,result){
 return task.coverage.map(row=>{
  if(row.status!=='planned')return row;
  const groups=row.checkIds.map(id=>result?.groups.find(g=>g.path.id===id));
  const status=!result?'planned':groups.some(g=>!g)?'unverified':groups.some(g=>g.status==='unverified'||g.status==='blocked')?'unverified':groups.some(g=>g.status==='issue')?'issue':'pass';
  return {...row,status,reason:status==='unverified'?'本轮未取得完整验证结果；已观察问题仍在问题区保留':row.reason};
 });
}
