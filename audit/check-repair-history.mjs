import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {startReadingRepairDemo} from '../v3/reading-repair-demo.mjs';
const out=path.resolve(process.argv[2]||'runs/repair-history-'+Date.now());await fs.mkdir(out);let demo=await startReadingRepairDemo({directory:out}),token;const checks=[];
const state=async()=>await(await fetch(demo.app.origin+'/state')).json();
async function auth(){token=(await(await fetch(demo.app.origin)).text()).match(/data-task-token="([^"]+)"/)[1];}await auth();
async function post(route,data){const s=await state(),r=await fetch(demo.app.origin+route,{method:'POST',headers:{Origin:demo.app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify({...data,...(route==='/prepare'?{}:{taskId:s.task.id,revision:s.task.revision})})});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;}
async function run(){let s=await state();s=await post('/revise',{excludedPaths:s.task.checks.filter(c=>!['add','read','export'].includes(c.id)).map(c=>c.id)});await post('/start',{confirmed:true,digest:s.task.digest});await demo.app.wait();return state();}
const get=route=>fetch(demo.app.origin+route);
try{
 const before=await run();assert.equal(before.businessAdvice[0].kind,'product-mismatch');
 // A later plan edit must not replace the criteria actually used for the old results.
 await post('/revise',{excludedPaths:before.task.checks.filter(c=>c.id!=='add').map(c=>c.id)});
 const source=path.join(demo.project,'app.js'),broken=await fs.readFile(source,'utf8');assert.match(broken,/read:false/);await fs.writeFile(source,broken.replace('({title,read})=>({title,read:false})','({title,read})=>({title,read})'));
 await post('/prepare',{projectPath:demo.project,url:demo.site.url+'index.html',mode:'reviewed-reading',normalRuns:2});let after=await run();assert.equal(after.repair.status,'verified-repair');
 const url=after.repair.beforeReportURL,baseline=path.join(out,'workbench',before.task.id),current=path.join(out,'workbench',after.task.id);
 const persisted=async()=>Promise.all([path.join(out,'workbench/active.json'),path.join(baseline,'session.json'),path.join(current,'session.json')].map(async file=>bodyHash(await fs.readFile(file))));
 const saved=await persisted(),control=JSON.stringify(after.control);
 let r=await get(url);assert.equal(r.status,200);let html=await r.text();assert.match(html,/上轮发现 1 条路径存在偏差/);assert.match(html,/最终导出与当前书目及状态一致/);assert.match(html,/预期：/);assert.match(html,/实际：/);assert.ok(!html.includes('<form'));await fs.writeFile(path.join(out,'prior-report.html'),html);
 const report=await(await get('/report')).text();assert.ok(report.includes(url));checks.push('current-report-opens-linked-prior-issue');
 const download=html.match(/href="([^"]+)" download>下载实际产物/)[1],shot=html.match(/href="([^"]+)">查看结果截图/)[1];
 const name=decodeURIComponent(download.split('/evidence/')[1]),original=await fs.readFile(path.join(baseline,'run',name));r=await get(download);assert.equal(r.status,200);assert.ok(original.equals(Buffer.from(await r.arrayBuffer())));assert.equal(JSON.parse(original).books[0].read,false);
 r=await get(shot);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/png/);assert.ok((await r.arrayBuffer()).byteLength>100);
 r=await get(url+'/evidence/plan.json');assert.equal(r.status,200);const plan=await r.json();assert.deepEqual(plan.paths.map(p=>p.id),['add','read','export']);checks.push('original-criteria-and-real-artifacts-survive-later-plan-edit');
 assert.deepEqual(await persisted(),saved);assert.equal(JSON.stringify((await state()).control),control);checks.push('readonly-navigation-preserves-current-task-and-session-bytes');
 for(const file of ['session.json','execution-identity.json','results.json','export-0.json','..%2Fsession.json','%2Fetc%2Fpasswd']){r=await get(url+'/evidence/'+file);assert.equal(r.status,409);}
 assert.equal((await get('/repair-before/'+('0'.repeat(64)))).status,409);checks.push('unrelated-files-and-forged-link-refused');
 await fs.appendFile(path.join(baseline,'run',name),' ');r=await get(url);assert.equal(r.status,409);assert.match(await r.text(),/暂时无法核验/);assert.equal((await get(download)).status,409);assert.equal((await state()).repair.status,'unverified');await fs.writeFile(path.join(baseline,'run',name),original);assert.equal((await get(url)).status,200);checks.push('changed-baseline-withdraws-history-and-repair-claim');
 const projectPort=Number(new URL(demo.site.url).port);await demo.close();demo=await startReadingRepairDemo({directory:out,projectPort});await auth();after=await state();assert.equal(after.repair.beforeReportURL,url);assert.equal((await get(url)).status,200);checks.push('restart-retains-same-readonly-link');
 if(process.argv.includes('--inspect')){console.log(JSON.stringify({origin:demo.app.origin,stage:'inspect-linked-prior-record',pid:process.pid}));await new Promise(resolve=>process.once('SIGUSR1',resolve));}
 await post('/prepare',{projectPath:demo.project,url:demo.site.url+'index.html',mode:'reviewed-reading',normalRuns:2});assert.equal((await get(url)).status,409);assert.equal((await get(download)).status,409);checks.push('task-switch-invalidates-old-page-and-artifact-links');
 const summary={scope:'受控阅读清单：新增、标记已读、导出三条路径，前后各两次；仅当前任务可信关联，只读导航',checks,checkCount:3,repetitions:2,priorAffectedPaths:1,afterAffectedPaths:0,userTimeSavedMs:null,uiReview:process.argv.includes('--inspect')?'separate-local-record':'not-run'};
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await demo.close();}
