import {businessAdvice,businessAdviceHTML} from './business-advice.mjs';
import {loadRepairHistory,repairHistoryHTML,repairHistoryUnavailable} from './repair-history.mjs';
import {snapshotRepairEligible,snapshotRepairTask} from './snapshot-repair.mjs';
import {captureRepairSource,repairEvidenceFile,sealRepairEvidence,loadRepairEvidence,repairStatus,repairHTML,repairBeforeURL} from './repair-evidence.mjs';
import {connectPage,connectJS,connectCSS} from './connect-page.mjs';
import {cloudCSS} from './cloud-page.mjs';
import {importStaticProject} from './project-import.mjs';
import {createReadStream} from 'node:fs';
import {chatPage} from './chat-entry.mjs';
import {codexContext} from './codex-context.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectProject} from '../v2/inspect.mjs';
import {createTaskControl} from '../v2/task-control.mjs';
import {readReportFile} from '../lib/report-file.mjs';
import {genericReport} from '../v2/report.mjs';
import {bodyHash} from '../lib/authorization.mjs';
import {sanitize} from '../lib/privacy.mjs';
import {discoverPage,localURL} from './discover.mjs';
import {compileTask,coverageResults,plannerLimits} from './planner.mjs';
import {compileBusinessTask,businessMode} from './business.mjs';
import {createExperienceStore} from './experience.mjs';
import {createAutoExperienceStore,applyAnalysis,experienceOutcomes,automaticReportHTML} from './auto-experience.mjs';
import {reportPDF,pdfSummaryHTML} from './report-export.mjs';
import {compileReportJourneys,reportImpact} from './report-journeys.mjs';
import {createSemanticProvider} from './semantic-provider.mjs';
import {buildHelpEvaluation,helpEvaluationHTML} from './help-evaluation.mjs';
import {workbenchPage,workbenchCSS,workbenchJS,coverageHTML} from './workbench-page.mjs';

const base=fileURLToPath(new URL('../',import.meta.url));
export async function startWorkbench({allowedRoot=base,stateDir=path.join(base,'state/workbench'),port=0,examples=[],evidenceReports=[],demoOnly=false,semanticProvider,reviewedReading}={}){
 allowedRoot=await fs.realpath(allowedRoot);await fs.mkdir(stateDir,{recursive:true,mode:0o700});
 const experiences=await createExperienceStore(path.join(stateDir,'experience'));
 const autoStore=await createAutoExperienceStore(path.join(stateDir,'automatic-experience'));
 const semantic=demoOnly?createSemanticProvider({enabled:false}):semanticProvider||createSemanticProvider();
 const enhance=async(task,intake,observation,files=[])=>{
  if(!semantic.available)throw Error('自动识别尚未配置模型连接；基础检查仍可使用');
  if(task.mode===businessMode)throw Error('自动经验首版用于基础页面检查；已审核业务模板不自动改写');
  const gathered=await autoStore.collect(intake.root,files);
  if(!gathered.materials.length){task.autoExperience={status:'no-materials',decisions:[],noExperienceReason:'本项目尚无已选纠正材料或后续反馈；本轮按当前目标检查，不编造历史帮助',files:gathered.files,materialHashes:[],calls:0};task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));return task;}
  const input={currentTask:{id:task.id,revision:task.revision},reportJourneys:(observation.reportJourneys||[]).map(j=>({id:j.id,kind:j.kind,name:j.name})),goal:task.goal,endpoint:task.endpoint,materials:gathered.materials,priorOutcomes:gathered.priorOutcomes,observedTargets:observation.observedTargets||[],pageTitle:observation.title};
  try{
   const {value,call}=await semantic.run(input);
   const enhanced=applyAnalysis(task,value,{...input,url:observation.url,observation},call);enhanced.autoExperience.files=gathered.files;enhanced.autoExperience.gaps=gathered.gaps;
   enhanced.digest=bodyHash(JSON.stringify({...enhanced,digest:undefined}));return enhanced;
  }catch(error){
   task.autoExperience={status:'unavailable',decisions:[],files:gathered.files,materialHashes:gathered.materials.map(m=>({id:m.id,hash:m.hash,disabled:!!m.disabled})),noExperienceReason:'本轮自动判断未完成，继续基础检查：'+sanitize(error.message)};
   task.gaps.push({kind:'semantic-unavailable',reason:task.autoExperience.noExperienceReason});task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));return task;
  }
 };
 const businessSettings=demoOnly?{}:{reviewedRoot:reviewedReading?.root,exportRegressions:reviewedReading?.exportRegressions===true};
 const importedProjects=new Map();
 const checkedRoot=async value=>{const root=await fs.realpath(value);if(!importedProjects.has(root)&&root!==allowedRoot&&!root.startsWith(allowedRoot+path.sep))throw Error('项目不在本次启动允许的目录内');return root;};
 const token=crypto.randomBytes(32).toString('hex');let origin,current=null,controller=null,controllerPromise=null,busy=false,learningPromise=Promise.resolve(),learningError=null,pdfCache=null;
 const save=async(file,data)=>{const next=file+'.'+crypto.randomUUID()+'.next';await fs.writeFile(next,JSON.stringify(sanitize(data),null,2),{mode:0o600});await fs.rename(next,file);};
 const folder=id=>{if(!/^task-[a-f0-9-]{36}$/.test(id))throw Error('任务标识无效');return path.join(stateDir,id);};
 const persist=async()=>{await save(path.join(folder(current.task.id),'session.json'),current);await save(path.join(stateDir,'active.json'),{id:current.task.id});};
 try{const pointer=JSON.parse(await fs.readFile(path.join(stateDir,'active.json'),'utf8'));current=JSON.parse(await fs.readFile(path.join(folder(pointer.id),'session.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const getController=async()=>{
  if(!current?.receipt)throw Error('尚未按任务范围开始');
  if(!controller){const session=current;
   if(session.receipt.authorizationHash!==bodyHash(JSON.stringify(session.confirmedAuthorization)))throw Error('原授权记录不一致，不能重新生成同意记录');
   controllerPromise??=createTaskControl({authorization:session.confirmedAuthorization,storeDir:path.join(stateDir,'authorizations'),execution:{baseURL:session.observation.url,plan:session.executionPlan,intake:session.intake,out:path.join(folder(session.task.id),'run'),scopeControl:id=>({excluded:session.task.excludedPaths.includes(id)})}}).catch(error=>{controllerPromise=null;throw error;});
   controller=await controllerPromise;
  }return controller;
 };
 // A finished execution without the session-held seal is not recoverable proof.
 // Never adopt an orphan index merely because it exists on disk.
 if(!demoOnly&&current?.receipt&&!current.repairSealHash){
  const state=(await getController()).state();
  if(state.worker?.phase==='finished'){
   current.repairError??='复检证据未确认：执行已结束，但封存记录未完整保存；请保留原记录并新建任务复检';
   await persist();
  }
 }
 const trackCompletion=(session,control)=>{
  if(demoOnly)return;learningError=null;learningPromise=control.wait().then(async()=>{
       const state=control.state();if(!state.reportAvailable)return;let seal;
       try{
        const finalSource=await inspectProject(session.intake.root);if(finalSource.fingerprint!==session.intake.fingerprint)throw Error('执行期间源码变化，不能确认本轮程序版本');
        seal={repairSealHash:await sealRepairEvidence(session,folder(session.task.id),state.worker.runId),repairSealFile:repairEvidenceFile(path.basename(state.worker.runId))};
       }catch(error){session.repairError='复检证据未确认：'+sanitize(error.message);}
       try{await save(path.join(folder(session.task.id),'session.json'),seal?{...session,...seal,repairError:undefined}:session);}catch(error){
        delete session.repairSealHash;delete session.repairSealFile;
        session.repairError='复检证据未确认：执行已结束，但封存记录未完整保存；请保留原记录并新建任务复检';throw error;
       }
       if(seal){Object.assign(session,seal);delete session.repairError;}
       if(session.task.autoExperience){const r=JSON.parse(await readReportFile(state.worker.runId,'results.json'));await autoStore.outcome(session.intake.root,session.task,r);}
      }).catch(error=>{learningError='执行结果尚未写入后续记录：'+sanitize(error.message);});};
 const result=async()=>{if(!current?.receipt)return null;const state=(await getController()).state();if(!state.reportAvailable)return null;return JSON.parse(await readReportFile(state.worker.runId,'results.json'));};
 const advice=async(session=current,r)=>{
  if(demoOnly||!session)return [];r??=await result();let verified=false;
  if(session.repairSealHash&&!session.repairError)try{await loadRepairEvidence(folder(session.task.id),session.repairSealHash,session.repairSealFile);verified=true;}catch{}
  if(current!==session)return [];
  return businessAdvice({task:session.task,result:r,evidenceVerified:verified,opinions:session.opinions});
 };
 const helpEvaluation=async(r)=>current?buildHelpEvaluation({task:current.task,result:r,automatic:experienceOutcomes(current.task,r),coverage:coverageResults(current.task,r),measurements:current.measurements}):null;
 const view=async()=>({businessAdvice:await advice(),adviceFeedbackHistory:current?.adviceFeedbackHistory||[],repair:demoOnly?null:await repairStatus(current,folder),helpEvaluation:await helpEvaluation(await result()),resumeDraft:current?{projectPath:current.intake.root,url:current.observation.url,kind:current.intake.root.startsWith(path.resolve(stateDir,'imports')+path.sep)?'snapshot':'directory',available:!current.intake.root.startsWith(path.resolve(stateDir,'imports')+path.sep)||importedProjects.has(current.intake.root)}:null,impacts:current?reportImpact(current.task,await result()):[],semantic:{available:semantic.available,name:semantic.name},learningError,automatic:current?experienceOutcomes(current.task,await result()):null,allowedRoot,examples,evidenceReports:evidenceReports.map(r=>({id:r.id,title:r.title,url:'/case-files/'+r.id+'/report.html'})),limits:plannerLimits,busy,task:current?.task||null,intake:current?{files:current.intake.files.map(x=>x.file),gaps:current.intake.gaps,coverage:current.intake.coverage}:null,observation:current?.observation||null,revisions:current?.revisions||[],receipt:!!current?.receipt,control:current?.receipt?(await getController()).state():null,coverage:current?coverageResults(current.task,await result()):[],opinions:current?.opinions||[]});
 const server=http.createServer(async(req,res)=>{
  const send=(code,data,type='application/json')=>{res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));};
  if(req.headers.host!==new URL(origin).host)return send(403,{error:'入口不匹配'});
  try{
   if(req.method==='GET'&&req.url==='/')return send(200,demoOnly?workbenchPage(token,{demoOnly}):chatPage(workbenchPage(token)),'text/html');
   if(req.method==='GET'&&req.url==='/workbench'&&!demoOnly)return send(200,workbenchPage(token).replace('class="product-brand" href="#top"','class="product-brand" href="/"'),'text/html');
   if(!demoOnly&&req.method==='GET'&&req.url==='/connect')return send(200,connectPage(token,snapshotRepairEligible(current,path.resolve(stateDir,'imports'))?current.task:null),'text/html');
   if(!demoOnly&&req.method==='GET'&&req.url==='/connect.js')return send(200,connectJS,'text/javascript');
   if(!demoOnly&&req.method==='GET'&&req.url==='/cloud.css')return send(200,cloudCSS+connectCSS,'text/css');
   if(req.method==='GET'&&req.url==='/style.css')return send(200,workbenchCSS,'text/css');
   if(req.method==='GET'&&req.url==='/app.js')return send(200,workbenchJS,'text/javascript');
   if(req.method==='GET'&&req.url==='/guide-video'&&!demoOnly)return send(200,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验收助手 · 使用演示</title><style>body{margin:0;background:white;color:#111;font:16px/1.7 system-ui}main{max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:26px}video{width:100%;background:#fff;border:2px solid #111;box-sizing:border-box}a{color:inherit;text-underline-offset:4px}p{color:#555}</style><main><a href="/">回到对话</a><h1>从一句目标，到修复复检</h1><video controls preload="metadata" src="/guide.mp4"></video><p>约 3 分半 · 中文合成旁白与字幕 · 实际界面截图讲解，包含独立受控修复对比。</p></main></html>','text/html');
   if(req.method==='GET'&&req.url==='/guide.mp4'&&!demoOnly){
    const file=path.resolve(base,'media/demo.mp4');
    let stat;try{stat=await fs.stat(file);}catch{return send(404,{error:'视频正在准备，请稍后重试'});}
    const match=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
    if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end();}
    res.writeHead(match?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(match?{'Content-Range':'bytes '+start+'-'+end+'/'+stat.size}:{})});createReadStream(file,{start,end}).pipe(res);return;
   }
   if(req.method==='GET'&&req.url==='/repair-comparison.json'&&!demoOnly){const comparison=await repairStatus(current,folder);return send(comparison?200:404,comparison||{error:'尚未关联同一项目的前后任务'});}
   if(req.method==='GET'&&req.url.startsWith('/repair-before/')){
    if(demoOnly)return send(404,{error:'此入口未提供'});
    const match=req.url.match(/^\/repair-before\/([a-f0-9]{64})(?:\/evidence\/([^/?]+))?$/);
    if(!match)return send(404,{error:'此入口未提供'});
    const session=current,url='/repair-before/'+match[1],isFile=!!match[2];
    const unavailable=(code,message)=>send(code,isFile?{error:message}:repairHistoryUnavailable(message),isFile?'application/json':'text/html');
    if(url!==repairBeforeURL(session))return unavailable(409,'任务已变化或记录不属于当前关联，请从当前结果重新进入。');
    try{
     const history=await loadRepairHistory(session,folder);
     const bytes=isFile?await history.readFile(decodeURIComponent(match[2])):null;
     if(current!==session||url!==repairBeforeURL(current))return unavailable(409,'任务已变化，请从当前结果重新进入。');
     if(!isFile)return send(200,repairHistoryHTML(history),'text/html');
     const file=decodeURIComponent(match[2]);
     if(!file.endsWith('.png'))res.setHeader('Content-Disposition','attachment; filename="prior-evidence.json"');
     return send(200,bytes,file.endsWith('.png')?'image/png':'application/json');
    }catch{return unavailable(409,'上轮源码、标准或实际产物缺失、变化，无法通过核验；所请求的文件也必须属于已核验产物。');}
   }
   if(req.method==='GET'&&req.url==='/business-advice.json'&&!demoOnly)return send(200,{advice:await advice(),history:current?.adviceFeedbackHistory||[]});
   if(req.method==='GET'&&req.url==='/state')return send(200,await view());
   if(req.method==='GET'&&req.url==='/repair-case.json'){if(demoOnly)return send(404,{error:'此入口未提供'});try{return send(200,await readReportFile(base,'evaluation/report-repair-case.json'),'application/json');}catch{return send(404,{error:'尚未生成修复案例'});}}
   if(req.method==='GET'&&req.url==='/codex-context.md'){
    if(demoOnly||!current)return send(404,{error:'请先建立本地任务'});
    const session=current,r=await result();
    const fresh=await autoStore.collect(session.intake.root,session.task.autoExperience?.files||[],{remember:false});
    const repair=await repairStatus(session,folder);if(current!==session)throw Error('任务已变化，请重新下载交接材料');
    const pack=codexContext({task:session.task,automatic:experienceOutcomes(session.task,r),root:session.intake.root,materials:fresh.materials,repair,businessAdvice:await advice(session,r),adviceFeedbackHistory:session.adviceFeedbackHistory||[]});
    res.setHeader('Content-Disposition','attachment; filename="codex-project-context.md"');res.setHeader('X-Context-SHA256',pack.hash);return send(200,pack.text,'text/markdown');
   }
   if(req.method==='GET'&&req.url.startsWith('/case-files/')){const match=req.url.match(/^\/case-files\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:json|png|html))$/),item=match&&evidenceReports.find(x=>x.id===match[1]);if(!item||!item.files.includes(match[2]))return send(404,{error:'此案例文件未提供'});return send(200,await readReportFile(item.root,match[2]),match[2].endsWith('.html')?'text/html':match[2].endsWith('.png')?'image/png':'application/json');}
   if(req.method==='GET'&&['/report','/report.pdf'].includes(req.url)){
    const session=current,r=await result();if(!r)throw Error('尚无完整结果文件，请查看当前任务进度');
    const repair=demoOnly?null:await repairStatus(session,folder);if(current!==session)throw Error('任务已变化，请重新打开报告');
    const rows=coverageResults(current.task,r),evaluation={pass:rows.every(x=>['pass','outside-scope','not-applicable'].includes(x.status))};
    const html=genericReport({impacts:reportImpact(current.task,r),controlled:current.task.mode===businessMode,coverageOnly:true,generatedAt:r.generatedAt,title:'本轮验收报告',description:r.goal,cases:[{id:'evidence',result:r}]},evaluation);
    const adviceForReport=await advice(session,r),adviceHistory=structuredClone(session.adviceFeedbackHistory||[]);
    const rendered=html.replace('<h2>路径覆盖</h2>',businessAdviceHTML(adviceForReport,adviceHistory)+repairHTML(repair)+'<section>'+helpEvaluationHTML(await helpEvaluation(r))+'</section>'+automaticReportHTML(experienceOutcomes(current.task,r))+coverageHTML(current.task,rows)+'<h2>路径覆盖</h2>');
    if(req.url==='/report.pdf'){
     if(demoOnly)throw Error('公开演示未开放个人报告 PDF');
     const key=current.task.digest+':'+bodyHash(JSON.stringify([r,current.measurements||null,repair,adviceForReport,adviceHistory])),task=structuredClone(current.task);
     if(pdfCache?.key!==key){const promise=reportPDF(pdfSummaryHTML({task,result:r,automatic:experienceOutcomes(task,r),impacts:reportImpact(task,r),coverage:rows,helpEvaluation:await helpEvaluation(r),repair,businessAdvice:adviceForReport,adviceFeedbackHistory:adviceHistory}),task);pdfCache={key,promise};promise.catch(()=>{if(pdfCache?.key===key)pdfCache=null;});}
     const pdf=await pdfCache.promise;
     if(current!==session||current.task.digest!==task.digest||JSON.stringify(await repairStatus(session,folder))!==JSON.stringify(repair)||JSON.stringify(await advice(session,r))!==JSON.stringify(adviceForReport)||JSON.stringify(session.adviceFeedbackHistory||[])!==JSON.stringify(adviceHistory))throw Error('任务、建议反馈或证据在生成期间发生变化，请重新下载报告');
     res.setHeader('Content-Disposition','attachment; filename="acceptance-report.pdf"');res.setHeader('X-Report-SHA256',pdf.hash);return send(200,pdf.bytes,'application/pdf');
    }
    return send(200,rendered,'text/html');
   }
   if(req.method==='GET'&&current?.receipt&&req.url.startsWith('/evidence/')){const file=decodeURIComponent(req.url.slice(10)),state=(await getController()).state();const bytes=await readReportFile(state.worker.runId,file);return send(200,bytes,file.endsWith('.png')?'image/png':'application/json');}
   if(req.method==='GET'&&req.url==='/results.json')return send(200,{helpEvaluation:await helpEvaluation(await result()),execution:await result(),impacts:current?reportImpact(current.task,await result()):[],automatic:current?experienceOutcomes(current.task,await result()):null,coverage:current?coverageResults(current.task,await result()):[]});
   if(req.method==='GET'&&req.url==='/help-evaluation.json')return send(200,await helpEvaluation(await result()));
   if(req.method==='GET'&&req.url==='/evaluation.json')return send(200,{pass:false,scope:'仅依据已检查项报告；七维缺项保留，不自动宣布整体通过',helpEvaluation:await helpEvaluation(await result())});
   if(req.method!=='POST'||!['/import-project','/prepare','/revise','/start','/command','/opinion','/suggest','/experience-save','/experience-adopt','/experience-brief','/experience-disable'].includes(req.url))return send(404,{error:'入口不存在'});
   if(req.headers.origin!==origin||req.headers['x-task-token']!==token||req.headers['content-type']!=='application/json')return send(403,{error:'任务页面已失效，请从本机入口重新打开'});
   if(busy)return send(409,{error:'上一项操作正在处理，请等待完成'});
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(!demoOnly&&req.url==='/import-project'?3000000:32768))return send(413,{error:'任务内容超过本轮容量'});}const data=JSON.parse(body);
   if(demoOnly){
    if(!['/prepare','/revise','/start','/command'].includes(req.url))return send(403,{error:'独立演示仅开放受控案例验收'});
    if(req.url==='/prepare'){
     const item=examples.find(x=>x.url===data.url&&x.projectPath===data.projectPath&&x.mode===data.mode);
     if(!item||data.normalRuns!==2||data.experienceId)throw Error('请选择提供的受控案例，本次固定验证 2 次');
    }
    if(req.url==='/revise'&&Object.keys(data).some(k=>!['taskId','revision','excludedPaths'].includes(k)))throw Error('演示仅支持缩小检查范围');
   }
   busy=true;const operationStarted=Date.now();let operationSucceeded=false;
   try{
    if(req.url==='/import-project'){
     if(importedProjects.size>=8)throw Error('本次启动已接入 8 份快照；请完成当前任务后重启本地助手。');
     if(current?.receipt){const control=(await getController()).state();if(control.worker?.running||control.pending.length||control.canStart)throw Error('原任务还在运行，请先完成或结束当前任务，再接入新版本。');}
     const project=await importStaticProject(data.files,path.join(stateDir,'imports'));importedProjects.set(project.root,project);
     return send(200,{projectPath:project.root,url:project.url,files:project.files,bytes:project.bytes,fingerprint:project.fingerprint,scope:'本机网页快照；未执行安装或后端启动脚本'});
    }else if(['/suggest','/experience-adopt','/experience-brief'].includes(req.url)){
     const root=await checkedRoot(data.projectPath),mode=data.mode||'basic';
     return send(200,req.url==='/suggest'?{suggestions:await experiences.suggest({root,mode,goal:data.goal||''})}:req.url==='/experience-brief'?{brief:await experiences.brief({id:data.id,root,mode,goal:data.goal})}:{experience:await experiences.adopt({id:data.id,root,mode})});
    }else if(req.url==='/prepare'){
     await learningPromise;if(current?.receipt){const state=(await getController()).state();if(state.worker?.running||state.pending.length||state.canStart)throw Error('原任务仍在进行或有待核对动作，请先处理原任务');}
     const root=await checkedRoot(data.projectPath);
     let snapshotPrior=null,snapshotEvidence=null;
     if(data.repairFrom){
      if(demoOnly||!snapshotRepairEligible(current,path.resolve(stateDir,'imports'))||data.repairFrom.taskId!==current.task.id||data.repairFrom.revision!==current.task.revision)throw Error('原任务已变化或不支持快照复检，请重新打开接入页');
      const imported=importedProjects.get(root);if(!imported||root===current.intake.root||data.url!==imported.url)throw Error('请选择新上传的网页快照，不得替换成其他页面');
      if((data.mode&&data.mode!=='basic')||data.automatic||data.experienceId||['goal','expectedText','endpoint','normalRuns','fieldValues','excludedPaths'].some(k=>data[k]!==undefined&&JSON.stringify(data[k])!==JSON.stringify(current.task[k])))throw Error('本次复检保留原标准；修改目标或标准请取消同项目复检，建立新任务');
      snapshotPrior=current;Object.assign(data,{goal:current.task.goal,expectedText:current.task.expectedText,endpoint:current.task.endpoint,normalRuns:current.task.normalRuns,fieldValues:current.task.fieldValues,excludedPaths:current.task.excludedPaths});snapshotEvidence=await loadRepairEvidence(folder(current.task.id),current.repairSealHash,current.repairSealFile);
     }
     if(data.mode&&!['basic',businessMode].includes(data.mode))throw Error('此任务模式尚未支持');
     localURL(data.url);const intake=await inspectProject(root),observation=await discoverPage(data.url,intake,{semanticTargets:data.automatic===true});
     const experience=data.experienceId?await experiences.adopt({id:data.experienceId,root,mode:data.mode||'basic'}):null;
     const id='task-'+crypto.randomUUID();let task=data.mode===businessMode?await compileBusinessTask({...businessSettings,id,normalRuns:data.normalRuns,intake,observation,excludedPaths:experience?.settings.excludedPaths||[]}):compileTask({id,goal:data.goal,endpoint:data.endpoint||'',expectedText:data.expectedText||'',normalRuns:data.normalRuns,intake,observation});
     if(snapshotPrior)task=snapshotRepairTask(snapshotPrior,{id,intake,observation});
     else if(task.mode!==businessMode)task=compileReportJourneys(task,observation);
     if(experience){if(task.mode===businessMode&&experience.source.templateHash!==task.templateHash)throw Error('历史业务模板已变化，请重新选择本轮路径');task.sources.experience={id:experience.id,taskId:experience.source.taskId,revision:experience.source.revision,note:experience.note,versionChanged:experience.source.fingerprint!==task.fingerprint,adopted:'操作者主动采纳为本轮草稿；当前表单要求优先，旧授权与执行记录不复用'};task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));}
     if(data.automatic===true){if(data.contextNote?.trim()){if(demoOnly)throw Error('公开演示不读取个人资料');await autoStore.feedback(root,{task,text:data.contextNote});}if(demoOnly)throw Error('公开演示不读取个人资料');task=await enhance(task,intake,observation,data.materialFiles||[]);}
     const sameProject=!demoOnly&&current&&current.intake.root===root&&current.observation.url===observation.url;
     const repairBaseline=snapshotPrior?{taskId:snapshotPrior.task.id,hash:snapshotPrior.repairSealHash,file:snapshotPrior.repairSealFile}:sameProject&&current.repairSealHash?{taskId:current.task.id,hash:current.repairSealHash,file:current.repairSealFile}:sameProject&&current.repairError&&current.repairBaseline?structuredClone(current.repairBaseline):null;
     await fs.mkdir(folder(id),{mode:0o700});current={adviceFeedbackHistory:sameProject?[...(current.adviceFeedbackHistory||[]),...current.opinions.filter(o=>o.adviceId).map(o=>({...o,taskId:current.task.id}))].slice(-20):[],repairBaseline,...(snapshotPrior?{repairProjectId:snapshotEvidence.projectId,repairCanonicalURL:snapshotPrior.repairCanonicalURL||snapshotPrior.observation.url,repairLinkKind:'user-confirmed-snapshot'}:repairBaseline&&current.repairProjectId?{repairProjectId:current.repairProjectId,repairCanonicalURL:current.repairCanonicalURL,repairLinkKind:current.repairLinkKind}:{}),task,intake,observation,revisions:[{revision:1,at:new Date().toISOString(),reason:'用户创建本次任务',goal:task.goal,digest:task.digest}],opinions:[],measurements:{version:1,events:[]}};controller=null;controllerPromise=null;
     await save(path.join(folder(id),'revision-1.json'),task);await persist();
    }else{
     if(!current||data.taskId!==current.task.id||data.revision!==current.task.revision)throw Error('任务或版本已变化，请刷新后操作');
     if(req.url==='/experience-disable'){
      await autoStore.disable(current.intake.root,data.sourceId);current.opinions.push({at:new Date().toISOString(),revision:current.task.revision,actor:'user',text:'已停用此经验，后续任务不再主动采用；原执行证据保留'});await persist();
     }else if(req.url==='/experience-save'){
      const report=await result();if(!report)throw Error('先完成本轮执行再保留经验');
      const record=await experiences.save({task:current.task,intake:current.intake,result:report,note:data.note||'',confirmed:data.confirmed});
      current.savedExperience={id:record.id,note:record.note};await persist();
     }else if(req.url==='/revise'){
      const old=current.task,ex=data.excludedPaths??old.excludedPaths;if(!Array.isArray(ex)||!ex.every(x=>old.checks.some(c=>c.id===x)))throw Error('移除的检查不属于当前任务');
      if(current.receipt){
       if(old.excludedPaths.some(x=>!ex.includes(x))||['goal','endpoint','expectedText','normalRuns','fieldValues'].some(k=>data[k]!==undefined&&JSON.stringify(data[k])!==JSON.stringify(old[k])))throw Error('开始后本轮仅支持缩小检查范围；改变预期或扩大作用不能直接迁移原任务');
      }
      if(old.mode===businessMode&&['goal','endpoint','expectedText','fieldValues'].some(k=>data[k]!==undefined&&JSON.stringify(data[k])!==JSON.stringify(old[k])))throw Error('已审核业务计划本轮只支持选择路径，不静默套用新的业务要求或样例');
      const args={id:old.id,revision:old.revision+1,goal:data.goal??old.goal,endpoint:data.endpoint??old.endpoint,expectedText:data.expectedText??old.expectedText,normalRuns:data.normalRuns??old.normalRuns,fieldValues:data.fieldValues??old.fieldValues,excludedPaths:ex,intake:current.intake,observation:current.observation};
      let task=old.mode===businessMode?await compileBusinessTask({...args,...businessSettings}):compileTask(args);
      if(old.mode!==businessMode)task=compileReportJourneys(task,current.observation,{excludedPaths:ex});
      if(old.autoExperience){
       if(current.receipt){task=structuredClone(old);task.revision=old.revision+1;}
       else task=await enhance(task,current.intake,current.observation,old.autoExperience.files||[]);
       task.excludedPaths=[...new Set(ex)].filter(id=>task.checks.some(c=>c.id===id));
       for(const c of task.checks)if(task.excludedPaths.includes(c.id))c.status='outside-scope';
       task.plan.paths=task.plan.paths.filter(p=>!task.excludedPaths.includes(p.id));
       task.coverage=task.coverage.map(r=>r.checkIds.some(id=>task.excludedPaths.includes(id))?{...r,status:'outside-scope',reason:'用户从本轮移除'}:r);
       task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));
      }
      if(old.sources.experience){task.sources.experience=old.sources.experience;task.digest=bodyHash(JSON.stringify({...task,digest:undefined}));}
      if(old.mode===businessMode&&task.templateHash!==old.templateHash)throw Error('审核模板已变化，请重新建立任务，不迁移原执行');
      current.task=task;current.revisions.push({revision:task.revision,at:new Date().toISOString(),reason:current.receipt?'用户缩小范围；原执行版本和已发生动作保留':'用户纠正待执行计划',goal:task.goal,digest:task.digest});
      await save(path.join(folder(task.id),'revision-'+task.revision+'.json'),task);await persist();
     }else if(req.url==='/start'){
      if(!current.task.plan.paths.length)throw Error('当前没有选中的可执行检查');
      if(current.receipt)throw Error('本任务已经开始；请使用原任务控制，不创建新次数');
      if(data.confirmed!==true||data.digest!==current.task.digest)throw Error('请按页面当前资料、目标和操作范围开始');
      const fresh=await inspectProject(current.intake.root);if(fresh.fingerprint!==current.intake.fingerprint)throw Error('已扫描源码自规划后发生变化，请重新读取并规划，旧任务保留');
      if(current.task.mode===businessMode){const check=await compileBusinessTask({...businessSettings,id:current.task.id,intake:current.intake,observation:current.observation,normalRuns:current.task.normalRuns,excludedPaths:current.task.excludedPaths});if(check.templateHash!==current.task.templateHash)throw Error('审核模板已变化，请重新建立任务');}
      if(current.task.autoExperience){const freshMaterials=await autoStore.collect(current.intake.root,current.task.autoExperience.files||[]);const hashes=freshMaterials.materials.map(s=>({id:s.id,hash:s.hash,disabled:!!s.disabled}));if(JSON.stringify(hashes)!==JSON.stringify(current.task.autoExperience.materialHashes))throw Error('个人依据已变化，请重新生成本轮计划；尚未执行');}
      for(const doc of current.task.reportDocuments||[]){const bytes=await readReportFile(current.intake.root,doc.file,{maxBytes:256000});if(bodyHash(bytes)!==doc.hash)throw Error('证据文件已变化，请重新生成计划');}
      current.confirmedAuthorization=structuredClone(current.task.proposedScope);current.confirmedAuthorization.source=current.task.mode===businessMode?'用户在当前版本任务页明确开始：仅受控阅读清单样例，按列出的输入、点击、筛选、刷新、导出和次数上限执行；不外发、不修改原始资料':'用户在本机任务入口明确开始；普通输入仅使用页面列出的本轮测试样例；只读指定本机页面及资源，不提交、不外发';
      if(!demoOnly)current.repairSource=await captureRepairSource(current,folder(current.task.id));
      current.executionPlan=structuredClone(current.task.plan);current.receipt={at:new Date().toISOString(),revision:current.task.revision,digest:current.task.digest,authorizationHash:bodyHash(JSON.stringify(current.confirmedAuthorization))};await persist();
      await(await getController()).command({command:'start'});
      trackCompletion(current,await getController());
     }else if(req.url==='/command'){
      if(!['pause','resume','skip','revoke','restore','end','query'].includes(data.command))throw Error('本轮入口不支持此控制动作');
      const control=await getController();
      if(data.command==='resume'){
       const state=control.state();if(!state.worker?.running||state.interrupted)await learningPromise;
       const fresh=await inspectProject(current.intake.root);if(fresh.fingerprint!==current.intake.fingerprint)throw Error('源码已变化，不能混用原检查点；请重新建立任务复检');
       if(!demoOnly)await captureRepairSource(current,folder(current.task.id));
       if(current.task.mode===businessMode){const check=await compileBusinessTask({...businessSettings,id:current.task.id,intake:current.intake,observation:current.observation,normalRuns:current.task.normalRuns,excludedPaths:current.task.excludedPaths});if(check.templateHash!==current.task.templateHash)throw Error('审核模板已变化，请重新建立任务');}
       if(current.task.autoExperience){const materials=await autoStore.collect(current.intake.root,current.task.autoExperience.files||[]);if(JSON.stringify(materials.materials.map(m=>({id:m.id,hash:m.hash,disabled:!!m.disabled})))!==JSON.stringify(current.task.autoExperience.materialHashes))throw Error('个人依据已变化，请重新建立任务');}
       for(const doc of current.task.reportDocuments||[]){if(bodyHash(await readReportFile(current.intake.root,doc.file,{maxBytes:256000}))!==doc.hash)throw Error('证据文件已变化，请重新建立任务');}
      }
      const response=await control.command({command:data.command,expectedRevision:data.expectedControlRevision,confirmed:data.confirmed});
      if(data.command==='resume'&&response?.started){
       if(current.repairSealHash)(current.repairSealHistory??=[]).push({hash:current.repairSealHash,file:current.repairSealFile||'repair-evidence.json'});
       delete current.repairSealHash;delete current.repairSealFile;delete current.repairError;await persist();
       trackCompletion(current,control);
      }
     }else{
      if(typeof data.text!=='string'||!data.text.trim()||data.text.length>2000)throw Error('请填写具体纠正意见（最多 2000 字）');
      let adviceFeedback={};
      if(data.adviceId!==undefined||data.adviceDecision!==undefined){
       if(!['accept','reject','correct'].includes(data.adviceDecision)||(await advice()).every(a=>a.id!==data.adviceId))throw Error('建议已变化或不属于当前任务，请重新查看本轮建议');
       adviceFeedback={adviceId:data.adviceId,adviceDecision:data.adviceDecision};
      }
      current.opinions.push({at:new Date().toISOString(),revision:current.task.revision,actor:'user',text:data.text,...adviceFeedback});
      if(current.task.autoExperience)await autoStore.feedback(current.intake.root,{task:current.task,text:data.text});await persist();
     }
    }
   operationSucceeded=true;
   }finally{
    try{if(current?.measurements&&(current.task.id===data.taskId||(req.url==='/prepare'&&operationSucceeded))){current.measurements.events.push({kind:req.url.slice(1),at:new Date().toISOString(),revision:current.task.revision,elapsedMs:Date.now()-operationStarted,success:operationSucceeded,...(req.url==='/prepare'?{contextSubmitted:!!(data.automatic&&data.contextNote?.trim())}:{})});await persist();}}finally{busy=false;}
   }
   return send(200,await view());
  }catch(error){send(400,{error:sanitize(error.message)});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {origin,stateDir,wait:async()=>{await controller?.wait();await learningPromise;},executionState:()=>controller?.state()||null,end:async()=>{if(controller&&!['ended'].includes(controller.state().control.status))await controller.command({command:'end',expectedRevision:controller.state().control.revision});},close:async()=>{await Promise.all([...importedProjects.values()].map(p=>new Promise(r=>p.server.close(r))));await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const app=await startWorkbench({allowedRoot:process.argv[2]||base,port:Number(process.argv[3]||4390)});console.log('本地验收任务入口：'+app.origin);}
