import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {redactText} from '../lib/privacy.mjs';

const fail=(ok,message)=>{if(!ok)throw Error(message);};
const safe=(text,max)=>typeof text==='string'&&text.length<=max&&redactText(text)===text;
const projectKey=root=>bodyHash(root);
export function refinementBrief(record,goal){
 fail(safe(goal,2000)&&goal.trim(),'先填写本次想改进的具体目标，不从旧任务猜测');
 fail(safe(record.note,500)&&record.note.trim(),'这条记录没有个人反馈说明，可用于重填设置，但不足以生成改进建议');
 return {kind:'structured-personal-brief',source:{id:record.id,taskId:record.source.taskId,revision:record.source.revision},goal,
  text:['本次改进目标',goal.trim(),'','同一项目的历史反馈（候选参考，不是本次强制要求）',record.note,'','历史任务背景',record.settings.goal,'','处理约定','以本次目标为准。先判断历史反馈是否适用；如有冲突，说明冲突并采用本次明确要求。不要从历史偏好推断本次必须采用的风格。','请围绕本次目标集中提出一个完整、可操作的改进方案，将建议与明确要求分开。需要判断的地方给出具体例子；信息不足时只指出会影响结果的缺口。','完成后对照本次要求检查完整性、一致性与可使用性。明确列出仍未验证的部分，不把建议或猜测当成验收通过。','','来源',`任务 ${record.source.taskId}，第 ${record.source.revision} 版；由操作者主动保留并选择参考。`].join('\n'),
  limits:'按明确目标与所选反馈整理的结构化草稿，未调用语义模型；没有验证它能减少实际设计对话轮数，不会执行修改。'};
}
export async function createExperienceStore(dir){
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 async function read(id){
  fail(/^[a-f0-9]{64}$/.test(id||''),'建议编号无效');const file=path.join(dir,id+'.json');fail(!(await fs.lstat(file)).isSymbolicLink(),'建议文件无效');const record=JSON.parse(await fs.readFile(file,'utf8'));
  const {digest,...payload}=record;fail(digest===bodyHash(JSON.stringify(payload))&&record.id===id,'建议来源已变化，不能继续使用');return record;
 }
 async function save({task,intake,note='',confirmed=false,result}){
  fail(confirmed===true,'仅在操作者明确选择后保留任务经验');fail(result?.groups?.length,'先完成本轮执行并查看结果，再保留经验');fail(safe(note,500),'经验说明含敏感信息或超过 500 字');
  const settings={mode:task.mode||'basic',goal:task.goal,endpoint:task.endpoint,expectedText:task.expectedText,normalRuns:task.normalRuns,...(task.mode==='reviewed-reading'?{excludedPaths:task.excludedPaths}: {})};
  fail([settings.goal,settings.endpoint,settings.expectedText].every(x=>safe(x,2000)),'任务设置含敏感信息，不作为个人建议保存');
  const source={taskId:task.id,revision:task.revision,project:task.plan.project,projectKey:projectKey(intake.root),fingerprint:task.fingerprint,templateHash:task.templateHash||null,planSource:task.plan.planSource,outcomes:result.groups.map(g=>({path:g.path.id,status:g.status})),kind:task.mode==='reviewed-reading'?'受控案例的操作者设置':'操作者主动保留的任务设置'};
  const id=bodyHash(JSON.stringify({source,settings,note}));
  const payload={id,recordedAt:new Date().toISOString(),source,settings,note,policy:'仅作为同一项目的候选建议，采纳后仍可修改；不自动成为本次要求，不包含旧授权、地址、原始文件或测试输入'};
  const record={...payload,digest:bodyHash(JSON.stringify(payload))};
  try{await fs.writeFile(path.join(dir,id+'.json'),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;return read(id);}return record;
 }
 async function suggest({root,mode='basic',goal=''}){
  fail(safe(goal,2000),'目标格式无效或含敏感信息');
  const files=(await fs.readdir(dir)).filter(x=>/^[a-f0-9]{64}\.json$/.test(x));fail(files.length<=500,'本地经验记录超过本轮读取预算');
  const records=[];for(const file of files){const r=await read(file.slice(0,-5));if(r.source.projectKey===projectKey(root)&&r.settings.mode===mode)records.push(r);}
  const grams=s=>new Set(Array.from(s).slice(0,-1).map((c,i)=>c+s[i+1]));const desired=grams(goal);
  const rank=r=>[...grams(r.settings.goal)].filter(x=>desired.has(x)).length;
  return records.sort((a,b)=>rank(b)-rank(a)||b.recordedAt.localeCompare(a.recordedAt)).slice(0,3).map(r=>({...r,reason:'同一项目、同一检查方式的已保留设置；请对照当前目标决定是否参考',matching:'本机范围与文字重合排序，非语义模型判断'}));
 }
 async function adopt({id,root,mode}){const r=await read(id);fail(r.source.projectKey===projectKey(root)&&r.settings.mode===mode,'此建议不属于当前项目或检查方式');return r;}
 return {save,suggest,adopt,brief:async args=>refinementBrief(await adopt(args),args.goal)};
}
