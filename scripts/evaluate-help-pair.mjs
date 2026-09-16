import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {evaluateHelpPair,evaluationVersion} from '../v3/help-evaluation.mjs';

// Local research/operator tool. Ordinary users do not fill this protocol.
const [mode,...args]=process.argv.slice(2);
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
if(mode==='--init-local'&&args.length===2){
 const source=new URL('/state',args[0]);if(!['127.0.0.1','localhost','[::1]'].includes(source.hostname))throw Error('只从本机验收助手生成效果实验草稿');
 const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('无法读取当前本地任务：HTTP '+response.status);
 const state=await response.json();if(!state.task)throw Error('请先建立本地验收任务');
 const criteria=state.task.checks.filter(check=>!state.task.excludedPaths.includes(check.id)).map(check=>({id:check.id,severity:'major',label:check.module,expected:check.expected}));
 const draft={completeRubric:state.task.contract?.declaredComplete===true,primaryMetric:'repeatExplanationCount',minimumReduction:1,maxExtra:{userActiveMs:300000,systemWaitMs:60000,costMinor:0},currency:'CNY',criteria,context:{taskHash:state.task.digest,initialRequestHash:bodyHash(state.task.goal),initialArtifactHash:state.task.fingerprint,modelConfigHash:bodyHash(JSON.stringify(state.semantic||{})),toolsHash:bodyHash(evaluationVersion),budgetHash:bodyHash(JSON.stringify(state.task.plan.policy))},notes:'开始 A/B 前复核标准、影响级别、最小改善值与额外负担上限。普通基础计划不会自动标为完整标准；项目验收契约明确声明完整时才为 true。'};
 await write(args[1],draft);console.log(JSON.stringify({draftFile:args[1],criteria:criteria.length,completeRubric:draft.completeRubric,next:'复核后使用 --freeze；真人 A/B 记录须逐项引用实际证据。'}));
}else if(mode==='--freeze'&&args.length===2){
 const spec=await read(args[0]);
 const protocol={...spec,version:evaluationVersion,frozenAt:new Date().toISOString(),context:{...spec.context,rubricHash:bodyHash(JSON.stringify(spec.criteria))}};
 await write(args[1],protocol);
 console.log(JSON.stringify({protocolFile:args[1],protocolHash:bodyHash(JSON.stringify(protocol)),note:'开始两组执行前保留此文件及指纹；不覆盖已有标准。'}));
}else if(mode==='--evaluate'&&args.length===4){
 const [protocolFile,aFile,bFile,output]=args,protocol=await read(protocolFile),arms=await Promise.all([read(aFile),read(bFile)]);
 const checks=[];
 for(const [index,arm] of arms.entries()){
  const refs=[...new Set([...(arm.acceptance||[]).flatMap(x=>x.evidence||[]),...Object.values(arm.metrics||{}).flatMap(x=>x.evidence||[])])];
  const files=arm.evidenceFiles||[];
  for(const id of refs){
   const source=files.find(x=>x.id===id);
   if(!source)throw Error(arm.arm+' 缺少证据索引：'+id);
   const bytes=await readReportFile(path.dirname(path.resolve(index===0?aFile:bFile)),source.file);
   if(bodyHash(bytes)!==source.sha256)throw Error(arm.arm+' 证据文件指纹变化：'+id);
   checks.push({arm:arm.arm,id,file:source.file,sha256:source.sha256});
  }
 }
 const assessment=evaluateHelpPair({protocol,arms});
 await write(output,{...assessment,evidenceChecks:checks,inputs:{protocol:bodyHash(JSON.stringify(protocol)),A:bodyHash(JSON.stringify(arms[0])),B:bodyHash(JSON.stringify(arms[1]))},limits:'核对本地证据完整性及审评规则；人工标注的真实性、完整性和历史因果关系仍需独立审查。受控数据不是真人收益。'});
 console.log(JSON.stringify({output,status:assessment.status,label:assessment.label}));
}else{
 throw Error('用法：node scripts/evaluate-help-pair.mjs --init-local http://127.0.0.1:4395 标准草稿.json；--freeze 标准草稿.json 冻结标准.json；或 --evaluate 冻结标准.json A.json B.json 新结果.json');
}
