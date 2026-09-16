// The caller must verify stored files before supplying these execution summaries.
// This compares recorded runs; it does not infer source identity from URLs.
export function compareRepairProgress(before,after,checkIds){
 if(!Array.isArray(checkIds)||!checkIds.length||new Set(checkIds).size!==checkIds.length)return null;
 for(const run of [before,after])if(!run?.evidenceVerified||!run.projectId||!run.programHash||!run.criteriaHash||!Array.isArray(run.groups)||run.groups.length!==checkIds.length||new Set(run.groups.map(g=>g.pathId)).size!==run.groups.length||checkIds.some(id=>!run.groups.some(g=>g.pathId===id)))return null;
 if(before.projectId!==after.projectId||before.criteriaHash!==after.criteriaHash||before.programHash===after.programHash)return null;
 const repeated=(g,status)=>g.status===status&&Array.isArray(g.records)&&g.records.length>=2&&g.records.every(r=>r.status===status&&Array.isArray(r.checks)&&r.checks.length&&r.checks.every(c=>['pass','issue'].includes(c.status))&&(status==='pass'?r.checks.every(c=>c.status==='pass'):r.checks.some(c=>c.status==='issue'&&!c.setup)));
 const complete=g=>repeated(g,'pass')||repeated(g,'issue');
 // Complete pairs already have a full repair comparison; this explains partial pairs only.
 if([...before.groups,...after.groups].every(complete))return null;
 const progress={fixed:[],newlyCheckedIssues:[],newlyCheckedPasses:[],regressions:[],stillUnverified:[],currentIssues:[]};
 for(const id of checkIds){
  const b=before.groups.find(g=>g.pathId===id),a=after.groups.find(g=>g.pathId===id),row={checkId:id,name:a.name||b.name||id};
  if(repeated(b,'issue')&&repeated(a,'pass'))progress.fixed.push(row);
  if(!complete(b)&&repeated(a,'issue'))progress.newlyCheckedIssues.push(row);
  if(!complete(b)&&repeated(a,'pass'))progress.newlyCheckedPasses.push(row);
  if(repeated(b,'pass')&&repeated(a,'issue'))progress.regressions.push(row);
  if(!complete(a))progress.stillUnverified.push(row);
  if(repeated(a,'issue'))progress.currentIssues.push(row);
 }
 const names=rows=>rows.map(r=>'「'+r.name+'」').join('、'),parts=[];
 if(progress.fixed.length)parts.push('原问题路径'+names(progress.fixed)+'已按原标准重复通过');
 if(progress.newlyCheckedIssues.length)parts.push('此前未完成验证的路径'+names(progress.newlyCheckedIssues)+'本轮确认偏差');
 if(progress.newlyCheckedPasses.length)parts.push('此前未完成验证的路径'+names(progress.newlyCheckedPasses)+'本轮重复通过');
 if(progress.regressions.length)parts.push('原已通过路径'+names(progress.regressions)+'本轮出现偏差');
 if(!parts.length)return null;
 return {...progress,message:parts.join('；')+'。以上为分项进展，整体修复仍未确认。',userTimeSavedMs:null};
}

export function compareRepairRuns(before, after, checkIds) {
 const result=(status,reason,extra={})=>({status,reason,...extra,userTimeSavedMs:null});
 if(!Array.isArray(checkIds)||!checkIds.length||new Set(checkIds).size!==checkIds.length)return result('unverified','缺少唯一、冻结的检查项');
 for(const run of [before,after]) {
  if(!run?.projectId||!run.programHash||!run.criteriaHash||!run.evidenceVerified)return result('unverified','项目、版本、标准或证据尚未核对');
  if(!Array.isArray(run.groups)||new Set(run.groups.map(g=>g.pathId)).size!==run.groups.length)return result('unverified','执行项缺失或重复');
  if(run.groups.length!==checkIds.length||checkIds.some(id=>!run.groups.some(g=>g.pathId===id)))return result('unverified','执行范围与原标准不一致');
  if(run.groups.some(g=>!['pass','issue'].includes(g.status)||!Array.isArray(g.records)||g.records.length<2||g.records.some(r=>!['pass','issue'].includes(r.status)||!Array.isArray(r.checks)||!r.checks.length||r.checks.some(c=>!['pass','issue'].includes(c.status)))))return result('unverified','有未验证、受阻或缺少重复证据的检查');
  if(run.groups.some(g=>g.status==='pass'&&g.records.some(r=>r.status!=='pass'||r.checks.some(c=>c.status!=='pass'))||g.status==='issue'&&!g.records.every(r=>r.status==='issue'&&r.checks.some(c=>c.status==='issue'&&!c.setup))))return result('unverified','汇总结果与重复执行证据不一致');
 }
 if(before.projectId!==after.projectId)return result('different-project','项目不同，不能作为同一问题的连续修复');
 if(before.criteriaHash!==after.criteriaHash)return result('criteria-changed','标准发生变化，需按原标准另行复查');
 if(before.programHash===after.programHash)return result('same-version-repeat','程序版本未变化，这是重复检查');
 const priorIssues=before.groups.filter(g=>g.status==='issue').map(g=>g.pathId);
 const remaining=after.groups.filter(g=>g.status==='issue').map(g=>g.pathId);
 const regressions=remaining.filter(id=>!priorIssues.includes(id));
 const fixed=priorIssues.filter(id=>!remaining.includes(id));
 if(regressions.length)return result('regression','修复版本出现已覆盖路径回归',{fixed,remaining,regressions});
 if(remaining.length)return result('still-failing','原问题仍未全部通过',{fixed,remaining,regressions});
 if(!priorIssues.length)return result('no-baseline-issue','没有修改前的问题证据，不能宣称修复',{fixed,remaining,regressions});
 return result('verified-repair','同一项目的修改版本按原标准重复通过，未见已覆盖路径回归',{fixed,remaining,regressions});
}
