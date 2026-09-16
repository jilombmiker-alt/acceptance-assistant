import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStaticProject} from '../v2/static-server.mjs';
import {startWorkbench} from './workbench.mjs';
const base=fileURLToPath(new URL('../',import.meta.url));
const files=['README.md','index.html','app.js','help.html'];
export async function startReadingRepairDemo({directory=path.join(base,'state/reading-repair'),port=0,projectPort=0}={}){
 directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true});const project=path.join(directory,'project');
 let created=false;try{await fs.mkdir(project);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 if(created){
  for(const f of files)await fs.copyFile(path.join(base,'projects/reading-list',f),path.join(project,f));
  const file=path.join(project,'app.js'),normal=await fs.readFile(file,'utf8'),needle='({title,read})=>({title,read})';
  if(normal.split(needle).length!==2)throw Error('样例已变化，未创建修复练习');
  await fs.writeFile(file,normal.replace(needle,'({title,read})=>({title,read:false})'));
 }
 for(const f of files)await fs.access(path.join(project,f)); // Existing source and records are never reset.
 const site=await startStaticProject(project,projectPort);let app;
 try{
  app=await startWorkbench({allowedRoot:project,stateDir:path.join(directory,'workbench'),port,reviewedReading:{root:project,exportRegressions:true}});
  const state=await(await fetch(app.origin+'/state')).json();
  if(!state.task){
   const token=(await(await fetch(app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];
   const response=await fetch(app.origin+'/prepare',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({projectPath:project,url:site.url+'index.html',mode:'reviewed-reading',normalRuns:2})});
   if(!response.ok)throw Error('练习计划生成失败：'+(await response.text()));
  }else if(state.resumeDraft?.url!==site.url+'index.html')throw Error('练习原地址已变化，请沿用原项目端口启动，不能混用旧记录');
  return {app,site,project,directory,close:async()=>{await app.end();await app.wait();await app.close();await new Promise(r=>site.server.close(r));}};
 }catch(e){if(app)await app.close();await new Promise(r=>site.server.close(r));throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const demo=await startReadingRepairDemo({directory:process.argv[2],port:4396,projectPort:4397});
 console.log('修复练习：'+demo.app.origin+'\n修改副本：'+path.join(demo.project,'app.js')+'\n先点“开始检查”；修改副本后，在原对话输入“重新检查”。原样例和旧证据保留。');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>demo.close().then(()=>process.exit(0)));
}
