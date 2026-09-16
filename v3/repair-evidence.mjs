import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {rebindSnapshotPlan} from './snapshot-repair.mjs';
import {compareRepairRuns,compareRepairProgress} from './repair-comparison.mjs';

// All paths and anchors come from the workbench's own session, never request JSON.
export async function captureRepairSource(session, directory) {
 const manifest=session.intake.files.map(({file,sha256})=>({file,sha256}));
 for(const row of manifest){
  const bytes=await readReportFile(session.intake.root,row.file,{maxBytes:256000});
  if(bodyHash(bytes)!==row.sha256)throw Error('源码已变化，请重新生成计划');
  const file=path.join(directory,'repair-source',row.file);await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||bodyHash(await readReportFile(directory,'repair-source/'+row.file))!==row.sha256)throw error;}
 }
 return {manifest,programHash:bodyHash(JSON.stringify(manifest)),scope:'仅已扫描文件；不代表完整产品版本或远端部署'};
}

export function repairEvidenceFile(runName='run') {
 if(!/^run(?:-resume-[a-f0-9-]{36})?$/.test(runName))throw Error('执行证据目录无效');
 return runName==='run'?'repair-evidence.json':'repair-evidence-'+runName+'.json';
}

export async function sealRepairEvidence(session,directory,runDirectory) {
 const runName=path.relative(directory,runDirectory),sealFile=repairEvidenceFile(runName);
 const bytes=await readReportFile(runDirectory,'results.json');const result=JSON.parse(bytes);
 const files=new Set(['results.json','execution-identity.json','plan.json']);
 for(const group of result.groups)for(const record of group.records){files.add(record.id+'.json');for(const file of record.outputs||[])files.add(file);for(const shot of record.snapshots||[])files.add(shot.file);}
 const manifest=[];
 for(const file of files)manifest.push({file,sha256:bodyHash(await readReportFile(runDirectory,file))});
 const evidence={schemaVersion:1,runDirectory:runName,taskId:session.task.id,projectId:session.repairProjectId||bodyHash(JSON.stringify([session.intake.root,session.observation.url])),criteriaHash:bodyHash(JSON.stringify(session.repairCanonicalURL?rebindSnapshotPlan(session.executionPlan,session.observation.url,session.repairCanonicalURL):session.executionPlan)),checkIds:session.executionPlan.paths.map(p=>p.id),source:session.repairSource,manifest,resultHash:bodyHash(bytes)};
 if(!evidence.source)throw Error('缺少执行前源码快照');
 const text=JSON.stringify(evidence,null,2);await fs.writeFile(path.join(directory,sealFile),text,{flag:'wx',mode:0o600});
 return bodyHash(text);
}

export async function loadRepairEvidence(directory,hash,sealFile='repair-evidence.json'){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('没有本轮执行时保存的证据指纹');
 if(!/^repair-evidence(?:-run-resume-[a-f0-9-]{36})?\.json$/.test(sealFile))throw Error('证据索引文件无效');
 const bytes=await readReportFile(directory,sealFile,{maxBytes:2000000});
 if(bodyHash(bytes)!==hash)throw Error('修复证据索引已变化');
 const evidence=JSON.parse(bytes),runName=evidence.runDirectory||'run';
 if(repairEvidenceFile(runName)!==sealFile)throw Error('执行目录与证据索引不一致');
 const run=path.join(directory,runName);
 for(const row of evidence.source.manifest)if(bodyHash(await readReportFile(directory,'repair-source/'+row.file))!==row.sha256)throw Error('已保存的源码快照缺失或变化');
 if(bodyHash(JSON.stringify(evidence.source.manifest))!==evidence.source.programHash)throw Error('源码版本指纹不一致');
 for(const row of evidence.manifest)if(bodyHash(await readReportFile(run,row.file))!==row.sha256)throw Error('执行记录或实际产物缺失、变化');
 const raw=await readReportFile(run,'results.json');if(bodyHash(raw)!==evidence.resultHash)throw Error('本轮结果与保存记录不一致');
 const result=JSON.parse(raw);
 return {...evidence,programHash:evidence.source.programHash,evidenceVerified:true,groups:result.groups.map(g=>({pathId:g.path.id,name:g.path.name,status:g.status,records:g.records.map(r=>({status:r.status,checks:r.checks}))}))};
}

export function repairBeforeURL(session){
 if(!session?.repairBaseline)return null;
 const b=session.repairBaseline;
 return '/repair-before/'+bodyHash(JSON.stringify([session.task.id,b.taskId,b.hash,b.file||'repair-evidence.json']));
}

export async function repairStatus(session,folder){
 if(!session?.repairBaseline)return null;
 const detail={beforeReportURL:repairBeforeURL(session),beforeTaskId:session.repairBaseline.taskId,afterTaskId:session.task.id,scope:session.repairLinkKind==='user-confirmed-snapshot'?'用户确认同项目的不同上传快照；关联已扫描源码与已执行路径，标准变化另行标明；不等于自动证明项目身份或整个产品合格':'同目录与同页面、已扫描源码及已执行路径；不等于整个产品合格',userTimeSavedMs:null};
 if(session.repairError)return {...detail,status:'unverified',reason:session.repairError};
 if(!session.repairSealHash)return {...detail,status:'pending',reason:'已关联上一轮；等待本轮执行和证据核对'};
 try{
  const before=await loadRepairEvidence(folder(detail.beforeTaskId),session.repairBaseline.hash,session.repairBaseline.file);
  const after=await loadRepairEvidence(folder(detail.afterTaskId),session.repairSealHash,session.repairSealFile);
  const planChanged=JSON.stringify(session.task.plan)!==JSON.stringify(session.executionPlan);
  const comparison=planChanged?{status:'criteria-changed',reason:'本轮执行后检查范围或标准发生变化，旧结果仅对应执行时版本；请重新建立任务复查'}:compareRepairRuns(before,after,before.checkIds);
  return {...detail,...comparison,...(!planChanged?{progress:compareRepairProgress(before,after,before.checkIds)}:{}),...(planChanged?{currentCriteriaHash:bodyHash(JSON.stringify(session.repairCanonicalURL?rebindSnapshotPlan(session.task.plan,session.observation.url,session.repairCanonicalURL):session.task.plan))}:{}),beforeProgramHash:before.programHash,afterProgramHash:after.programHash,beforeCriteriaHash:before.criteriaHash,afterCriteriaHash:after.criteriaHash,changedFiles:[...new Set([...before.source.manifest.map(f=>f.file),...after.source.manifest.map(f=>f.file)])].filter(file=>before.source.manifest.find(f=>f.file===file)?.sha256!==after.source.manifest.find(f=>f.file===file)?.sha256),issues:before.groups.filter(g=>g.status==='issue').map(g=>({issueId:bodyHash(before.projectId+':'+before.criteriaHash+':'+g.pathId).slice(0,16),checkId:g.pathId,name:g.name,observedDifferences:g.records[0].checks.filter(c=>c.status==='issue'&&!c.setup).map(c=>({label:c.label,expected:c.expected,actual:c.actual}))}))};
 }catch{return {...detail,status:'unverified',reason:'前后源码、执行记录或实际产物无法通过指纹核对，请保留原记录并重新验收'};}
}

export function repairHTML(value,{download=true}={}){
 if(!value)return '';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<section id="repair-result" style="overflow-wrap:anywhere"><h2>本次复检</h2><p>'+esc(value.reason)+'</p>'+(value.progress?'<p>'+esc(value.progress.message)+'</p>':'')+'<p>'+esc(value.scope)+'。人工省时：未测得。</p><details><summary>查看前后版本与标准</summary><p>前次任务：'+esc(value.beforeTaskId)+'<br>本次任务：'+esc(value.afterTaskId)+'</p><p style="overflow-wrap:anywhere">修改文件：'+esc((value.changedFiles||[]).join('、')||'未确认变化')+'<br>修改前源码指纹：'+esc(value.beforeProgramHash||'未取得')+'<br>修改后源码指纹：'+esc(value.afterProgramHash||'未取得')+'<br>原标准指纹：'+esc(value.beforeCriteriaHash||'未取得')+'<br>本轮执行标准指纹：'+esc(value.afterCriteriaHash||'未取得')+(value.currentCriteriaHash?'<br>当前计划标准指纹：'+esc(value.currentCriteriaHash):'')+'</p><p>已通过原问题路径：'+esc((value.fixed||value.progress?.fixed.map(x=>x.checkId)||[]).map(id=>value.issues?.find(i=>i.checkId===id)?.name||id).join('、')||'尚未确认')+'<br>剩余问题路径：'+esc(Array.isArray(value.remaining)?(value.remaining.join('、')||'无（仅已覆盖路径）'):value.progress?(value.progress.currentIssues.map(x=>x.name).join('、')||'尚无重复确认的偏差；未验证项仍保留'):'尚未确认')+'</p></details>'+(download?(value.beforeReportURL?'<p><a href="'+esc(value.beforeReportURL)+'">查看上轮问题与证据</a></p>':'')+'<a href="/repair-comparison.json" download>下载复检关联记录</a>':'<p>复检关联数据：repair-comparison.json。请与本报告及原始证据一起保存。</p>')+'</section>';
}
