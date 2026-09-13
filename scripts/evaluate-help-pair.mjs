import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {evaluateHelpPair,evaluationVersion} from '../v3/help-evaluation.mjs';

// Local research/operator tool. Ordinary users do not fill this protocol.
const [mode,...args]=process.argv.slice(2);
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
if(mode==='--freeze'&&args.length===2){
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
 throw Error('用法：node scripts/evaluate-help-pair.mjs --freeze 标准草稿.json 冻结标准.json；或 --evaluate 冻结标准.json A.json B.json 新结果.json');
}
