import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {loadRepairEvidence,repairBeforeURL} from './repair-evidence.mjs';

// Resolve only the current task's saved baseline, never a request-supplied task ID.
export async function loadRepairHistory(session,folder){
 const anchor=session?.repairBaseline;if(!anchor)throw Error('本轮尚未关联上轮记录');
 const directory=folder(anchor.taskId),evidence=await loadRepairEvidence(directory,anchor.hash,anchor.file);
 if(evidence.taskId!==anchor.taskId)throw Error('上轮记录身份不一致');
 const run=path.join(directory,evidence.runDirectory||'run');
 const read=async file=>{
  const row=evidence.manifest.find(r=>r.file===file);if(!row)throw Error('此文件不属于上轮已核验记录');
  const bytes=await readReportFile(run,file);if(bodyHash(bytes)!==row.sha256)throw Error('上轮证据已变化');return bytes;
 };
 const result=JSON.parse(await read('results.json')),plan=JSON.parse(await read('plan.json'));
 // Expose criteria and actual artifacts; authorization and raw session files stay private.
 const files=new Set(['plan.json']);
 for(const group of result.groups)for(const record of group.records){
  for(const file of record.outputs||[])files.add(file);
  for(const shot of record.snapshots||[])files.add(shot.file);
 }
 return {url:repairBeforeURL(session),evidence,result,plan,readFile:async file=>{
  if(!files.has(file))throw Error('此文件未提供');return read(file);
 }};
}

const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=x=>e(x===undefined?'未记录':typeof x==='string'?x:JSON.stringify(x));
const status=x=>({pass:'通过',issue:'发现偏差',blocked:'受阻',unverified:'未验证',error:'执行异常',skipped:'未执行'})[x]||x;
const shell=body=>'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>上轮问题与证据 · 验收助手</title><style>body{margin:0;background:#fff;color:#111;font:16px/1.8 system-ui}main{max-width:800px;margin:48px auto;padding:0 24px 48px;overflow-wrap:anywhere}.mark{width:32px;height:6px;background:#111;margin:32px 0 20px}h1{font-size:28px;line-height:1.4}h2{font-size:20px}p{margin:12px 0}a{color:inherit;text-underline-offset:5px;text-decoration-thickness:2px}nav{display:flex;gap:24px;flex-wrap:wrap}nav a,summary{min-height:44px;display:inline-flex;align-items:center}summary{cursor:pointer;font-weight:650}details{border-top:2px solid #111;padding:12px 0;margin-top:20px}.record{border-top:1px solid #ccc;padding:12px 0}.label{font-weight:700}.muted{color:#555;font-size:14px}.links{display:flex;gap:12px 24px;flex-wrap:wrap}.links a{min-height:44px;display:inline-flex;align-items:center}pre{white-space:pre-wrap;font:14px/1.7 ui-monospace,monospace}a:focus-visible,summary:focus-visible{outline:3px solid #111;outline-offset:4px}@media(max-width:600px){main{margin:24px auto}h1{font-size:25px}}</style><main><nav><a href="/">回到当前对话</a><a href="/report">查看当前报告</a></nav><div class="mark" aria-hidden="true"></div>'+body+'</main></html>';

export function repairHistoryUnavailable(message){
 return shell('<h1>暂时无法核验上轮记录</h1><p>'+e(message)+'</p><p>保留原记录，回到当前报告核对状态；不要据此判断问题已经修复。</p>');
}

export function repairHistoryHTML(history){
 const {evidence,result,plan,url}=history;
 const link=(file,label)=>'<a href="'+e(url+'/evidence/'+encodeURIComponent(file))+'"'+(file.endsWith('.png')?'':' download')+'>'+e(label)+'</a>';
 const groupHTML=g=>'<details'+(g.status==='issue'?' open':'')+'><summary>'+e(g.path.name)+' · '+e(status(g.status))+'</summary><p>位置：'+e(g.path.location||'未记录')+'<br>触发操作：'+e(g.path.trigger||'未记录')+'<br>依据：'+e((g.path.basis||[]).join('、')||'未记录')+'</p>'+g.records.map((r,i)=>'<div class="record"><p class="label">第 '+(i+1)+' 次 · '+e(status(r.status))+'</p>'+r.checks.filter(c=>!c.setup||c.status!=='pass').map(c=>'<p>'+e(c.label)+(c.setup?'（前置检查）':'')+' · '+e(status(c.status))+'<br>预期：'+value(c.expected)+'<br>实际：'+value(c.actual)+'</p>').join('')+'<div class="links">'+(r.outputs||[]).map(file=>link(file,'下载实际产物')).join('')+(r.snapshots?.length?link(r.snapshots.at(-1).file,'查看结果截图'):'')+'</div></div>').join('')+'</details>';
 const issues=result.groups.filter(g=>g.status==='issue'),other=result.groups.filter(g=>g.status!=='issue');
 return shell('<h1>上轮问题与证据</h1><p>这是本次复检关联的上轮执行记录，只读查看。当前任务保持不变。</p><p>上轮发现 '+issues.length+' 条路径存在偏差；这是受影响路径数，不等于独立缺陷数。</p>'+issues.map(groupHTML).join('')+(other.length?'<details><summary>其他已执行路径（'+other.length+'）</summary>'+other.map(groupHTML).join('')+'</details>':'')+'<details><summary>核对原标准与版本</summary><p>原执行目标：'+e(plan.goal||'未记录')+'<br>原定重复次数：'+e(plan.policy?.normalRuns??'未记录')+'</p><p class="muted">本页采用封存的执行标准与记录，后续计划调整不会替换它。标准文件中的敏感输入可能已经脱敏。</p>'+link('plan.json','下载原执行标准')+'<p class="muted">上轮源码指纹：'+e(evidence.programHash)+'<br>原标准指纹：'+e(evidence.criteriaHash)+'</p></details><p class="muted">证据已在本次打开时逐文件核对。仅限已扫描源码和已执行路径，不代表整个产品合格；人工省时未测得。任务变化后，旧页面的证据链接会失效，请从当前结果重新进入。</p>');
}
