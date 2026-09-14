// Run the product's own planner and executor against its generated intake UI.
// File selection / submission require the separate live flow review.
import fs from 'node:fs/promises';
import path from 'node:path';
import {connectPage,connectJS,connectCSS} from '../v3/connect-page.mjs';
import {cloudCSS} from '../v3/cloud-page.mjs';
import {startStaticProject} from '../v2/static-server.mjs';
import {startWorkbench} from '../v3/workbench.mjs';
const out=path.resolve(process.argv[2]||'state/self-review-'+Date.now());
await fs.mkdir(out,{recursive:true});
const siteRoot=path.join(out,'rendered-ui');await fs.mkdir(siteRoot);
await fs.writeFile(path.join(siteRoot,'index.html'),connectPage('self-review-placeholder'));
await fs.writeFile(path.join(siteRoot,'connect.js'),connectJS);
await fs.writeFile(path.join(siteRoot,'cloud.css'),cloudCSS+connectCSS);
const site=await startStaticProject(siteRoot),app=await startWorkbench({allowedRoot:siteRoot,stateDir:path.join(out,'checker')});
try{
 const html=await(await fetch(app.origin)).text(),token=html.match(/data-task-token="([a-f0-9]+)"/)[1];
 const post=async(route,data)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
 const s=await post('/prepare',{projectPath:siteRoot,url:site.url,goal:'检查输入框、页面说明和手机适配',expectedText:'先接入你的网页。',normalRuns:2});
 await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});await app.wait();
 const result=await(await fetch(app.origin+'/results.json')).json();
 const summary={scope:'Product planner/executor testing the generated connect page: entry, text, ordinary fields, viewport and supported disclosures. Live upload/API flow checked separately.',checks:result.execution.groups.map(g=>({id:g.path.id,status:g.status,repetitions:g.records.length,errors:g.records.filter(r=>r.error).map(r=>r.error)}))};
 await fs.writeFile(path.join(out,'report.html'),await(await fetch(app.origin+'/report')).text());
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await app.end();await app.close();await new Promise(r=>site.server.close(r));}
