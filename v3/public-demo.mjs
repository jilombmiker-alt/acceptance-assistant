import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {cloudPage,cloudCSS,cloudJS} from './cloud-page.mjs';
import {fileURLToPath} from 'node:url';
import {startWorkbench} from './workbench.mjs';
import {startReadingServer} from '../v2/reading-server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const cookieName='acceptance_demo';
const getRoutes=new Set(['/','/app.js','/style.css','/state','/report','/results.json','/evaluation.json']);
const postRoutes=new Set(['/prepare','/revise','/start','/command']);
const variants=[['k2','阅读清单 · 正常版本'],['l8','阅读清单 · 导出不一致的受控版本'],['m9','阅读清单 · 新增失败的受控版本']];

// Each visitor owns a separate workbench, authorization ledger and browser run.
// Neither a client URL nor a client filesystem path is used as an execution target.
export async function startPublicDemo({port=0,host='127.0.0.1',publicOrigin,cloud=false,stateDir=path.join(root,'state/public-demo'),maxSessions=8,maxConcurrent=2,maxTasks=3,sessionMs=30*60_000,runMs=5*60_000}={}){
 if(host!=='127.0.0.1'&&!publicOrigin)throw Error('公开监听需要明确配置 PUBLIC_ORIGIN');
 for(const n of [maxSessions,maxConcurrent,maxTasks,sessionMs,runMs])if(!Number.isSafeInteger(n)||n<1)throw Error('演示限额必须为正整数');
 if(publicOrigin){const u=new URL(publicOrigin);if(!['http:','https:'].includes(u.protocol)||u.origin!==publicOrigin||u.username||u.password)throw Error('PUBLIC_ORIGIN 必须是完整来源，不含路径或账号');}
 const bootDir=path.join(stateDir,'boot-'+crypto.randomUUID());await fs.mkdir(bootDir,{recursive:true,mode:0o700});
 const site=await startReadingServer(),sessions=new Map();let pendingSessions=0,origin=publicOrigin,closing=false;
 const cleanText=(text,s)=>text.split(s.dir).join('演示会话').split(bootDir).join('演示会话').split(root.replace(/\/$/, '')).join('演示项目').replace(/http:\/\/127\.0\.0\.1:\d+/g,'http://demo.local');
 const occupied=()=>[...sessions.values()].filter(s=>s.reserved).length;
 const destroy=async s=>{if(s.disposing)return s.disposing;s.expired=true;s.disposing=(async()=>{await s.app.end();await s.app.wait().catch(()=>{});await s.app.close();await fs.rm(s.dir,{recursive:true,force:true});sessions.delete(s.id);})();return s.disposing;};
 const create=async()=>{
  if(sessions.size+pendingSessions>=maxSessions)throw Object.assign(Error('演示会话已满，请稍后再试'),{status:429});
  pendingSessions++;
  try{
   const id=crypto.randomBytes(32).toString('hex'),dir=path.join(bootDir,id);
   const examples=variants.map(([key,label])=>({label,mode:'reviewed-reading',projectPath:path.join(root,'projects/reading-list'),url:site.url+'/'+key+'/index.html'}));
   const app=await startWorkbench({allowedRoot:path.join(root,'projects/reading-list'),stateDir:dir,examples,demoOnly:true});
   const s={id,dir,app,examples,created:Date.now(),tasks:0,reserved:false,mutating:false,expired:false};sessions.set(id,s);return s;
  }finally{pendingSessions--;}
 };
 const server=http.createServer(async(req,res)=>{
  const send=(status,body,type='application/json; charset=utf-8',extra={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",...extra});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  let s,mutating=false;
  try{
   if(closing)return send(503,{error:'演示正在关闭'});
   // The public cloud proxy rewrites Host and adds embed query parameters.
   // POST requests still require the exact configured public Origin and per-session token.
   if(!cloud&&req.headers.host!==new URL(origin).host)return send(403,{error:'演示入口不匹配'});
   if(cloud&&req.method==='GET')req.url=new URL(req.url,origin).pathname;
   if(req.method==='GET'&&req.url==='/healthz')return send(200,{status:'ready',scope:'controlled-demo'});
   if(cloud&&req.method==='GET'){
    if(req.url==='/cloud.css')return send(200,cloudCSS,'text/css; charset=utf-8');
    if(req.url==='/cloud.js')return send(200,cloudJS,'text/javascript; charset=utf-8');
    if(req.url==='/repair-case.json')return send(200,await fs.readFile(path.join(root,'evaluation/report-repair-case.json')));
   }
   const evidence=req.method==='GET'&&/^\/evidence\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:png|json|csv|txt)$/.test(req.url)&&!req.url.includes('..');
   if(!(req.method==='GET'&&(getRoutes.has(req.url)||evidence||cloud&&req.url==='/workbench')||req.method==='POST'&&postRoutes.has(req.url)))return send(404,{error:'演示入口未提供'});
   const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
   s=/^[a-f0-9]{64}$/.test(id||'')?sessions.get(id):null;
   if(s&&(s.expired||Date.now()-s.created>sessionMs)){if(!s.mutating)void destroy(s).catch(()=>{});s=null;}
   if(!s){
    if(req.method!=='GET'||req.url!=='/')return send(401,{error:'会话已过期，请重新打开演示首页'});
    // A cross-site embedded request cannot allocate a visitor session.
    let platformFrame=false;try{platformFrame=cloud&&['https://modelscope.cn','https://www.modelscope.cn'].includes(new URL(req.headers.referer).origin);}catch{}
    if(['cross-site'].includes(req.headers['sec-fetch-site'])&&!platformFrame)return send(403,{error:'请直接打开演示入口'});
    s=await create();res.setHeader('Set-Cookie',cookieName+'='+s.id+'; Path=/; HttpOnly; '+(cloud&&origin.startsWith('https:')?'SameSite=None; Secure; Partitioned':'SameSite=Strict'+(origin.startsWith('https:')?'; Secure':''))+'; Max-Age='+Math.ceil(sessionMs/1000));
   }
   let body;
   if(req.method==='POST'){
    if(req.headers.origin!==origin||req.headers['content-type']!=='application/json')return send(403,{error:'请从当前演示页面操作'});
    if(s.mutating)return send(409,{error:'上一项操作正在处理，请稍后重试'});
    s.mutating=true;mutating=true;
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)return send(413,{error:'任务内容超过本轮容量'});chunks.push(chunk);}
    body=JSON.parse(Buffer.concat(chunks).toString());
    if(req.url==='/prepare'){
     if(s.tasks>=maxTasks)return send(429,{error:'本会话已达 '+maxTasks+' 个任务上限，请查看已有报告'});
     const item=s.examples.find(x=>'http://demo.local'+new URL(x.url).pathname===body.url);
     if(!item||body.projectPath!=='演示项目/projects/reading-list'||body.mode!=='reviewed-reading'||body.normalRuns!==2||body.experienceId)return send(400,{error:'请选择提供的受控案例，本次固定验证 2 次'});
     body={projectPath:item.projectPath,url:item.url,mode:item.mode,normalRuns:2};
    }
    const needsSlot=req.url==='/prepare'||req.url==='/start'||req.url==='/command'&&body.command==='resume'&&!s.reserved;
    if(needsSlot){
     if(s.reserved)return send(409,{error:'本会话仍有运行中的任务，请先完成或结束'});
     if(occupied()>=maxConcurrent)return send(429,{error:'演示正在运行其他任务，请稍后再次点击；本次尚未开始'});
     s.reserved=true;s.runningSince=Date.now();
    }
   }
   const response=await fetch(s.app.origin+(cloud&&req.url==='/workbench'?'/':req.url),{method:req.method,headers:req.method==='POST'?{'Content-Type':'application/json',Origin:s.app.origin,'X-Task-Token':req.headers['x-task-token']||''}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25_000)});
   if(req.url==='/prepare'&&req.method==='POST'&&response.ok)s.tasks++;
   if(req.url==='/prepare'||req.url==='/start'&&!response.ok||!response.ok&&!s.app.executionState()?.worker?.running)s.reserved=false;
   const type=response.headers.get('content-type')||'application/octet-stream';
   if(type.startsWith('image/'))return send(response.status,Buffer.from(await response.arrayBuffer()),type);
   let text=await response.text();
   if(cloud&&req.url==='/'){
    const token=text.match(/data-task-token="([a-f0-9]+)"/)?.[1];if(!token)throw Error('无法创建页面会话');
    return send(200,cloudPage(token),'text/html; charset=utf-8',{'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self' https://modelscope.cn https://www.modelscope.cn; base-uri 'none'; form-action 'self'"});
   }
   if(req.url!=='/app.js'&&req.url!=='/style.css')text=cleanText(text,s);
   return send(response.status,text,type);
  }catch(e){if(s&&['/prepare','/start'].includes(req.url)&&!s.app.executionState()?.worker?.running)s.reserved=false;send(e.status||400,{error:e.status?e.message:'请求未完成，请刷新当前页面后重试'});}
  finally{if(mutating)s.mutating=false;}
 });
 server.requestTimeout=30_000;server.headersTimeout=10_000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});origin??='http://127.0.0.1:'+server.address().port;
 const timer=setInterval(()=>{for(const s of sessions.values()){
  if(s.mutating||s.disposing)continue;
  if(Date.now()-s.created>sessionMs){void destroy(s).catch(()=>{});continue;}
  const state=s.app.executionState();
  if(s.reserved&&state?.worker&&!state.worker.running)s.reserved=false;
  if(s.reserved&&Date.now()-s.runningSince>runMs)void s.app.end().catch(()=>{});
 }},250);timer.unref();
 return {origin,bootDir,close:async()=>{closing=true;clearInterval(timer);await new Promise(r=>server.close(r));await Promise.all([...sessions.values()].map(destroy));await new Promise(r=>site.server.close(r));await fs.rm(bootDir,{recursive:true,force:true});}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await startPublicDemo({port:Number(process.env.PORT||4394),host:process.env.DEMO_HOST||'127.0.0.1',publicOrigin:process.env.PUBLIC_ORIGIN||undefined,cloud:process.env.CLOUD_DEMO==='1',stateDir:process.env.DEMO_STATE_DIR||undefined});
 console.log('独立演示入口：'+app.origin);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
