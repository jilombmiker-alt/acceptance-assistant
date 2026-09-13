import assert from 'node:assert/strict';
import {startPublicDemo} from '../v3/public-demo.mjs';
import {cloudJS} from '../v3/cloud-page.mjs';
new Function(cloudJS);
const app=await startPublicDemo({cloud:true,maxSessions:3,stateDir:'/private/tmp/acceptance-cloud-check'});
const checks=[];
const get=(route,headers={})=>fetch(app.origin+route,{headers});
try{
 const home=await get('/');assert.equal(home.status,200);const html=await home.text(),cookie=home.headers.get('set-cookie').split(';')[0],token=html.match(/data-task-token="([a-f0-9]+)"/)[1];assert.match(html,/说说你想完成什么/);checks.push('single-dialog-home');
 const h={Cookie:cookie};const state=await(await get('/state',h)).json();assert.equal(state.examples.length,3);
 const video=await get('/guide.mp4',{Range:'bytes=0-1023'});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,1024);assert.match(video.headers.get('content-type'),/video\/mp4/);
 assert.equal((await get('/guide-video')).status,200);assert.equal((await get('/repair-case.json')).status,200);checks.push('anonymous-video-and-comparison');
 const post=async(route,data,status=200)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{...h,'Content-Type':'application/json',Origin:app.origin,'X-Task-Token':token},body:JSON.stringify(data)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d).slice(0,200));return d;};
 await post('/prepare',{...state.examples[1],url:'http://169.254.169.254/',normalRuns:2},400);assert.equal((await get('/state')).status,401);checks.push('fixed-target-and-session-boundaries');
 for(const i of [1,0]){
  console.log('Running case',i);
  let s=await post('/prepare',{...state.examples[i],normalRuns:2});s=await post('/revise',{taskId:s.task.id,revision:s.task.revision,excludedPaths:s.task.checks.filter(c=>!['add','read','export'].includes(c.id)).map(c=>c.id)});await post('/start',{taskId:s.task.id,revision:s.task.revision,digest:s.task.digest,confirmed:true});
  const until=Date.now()+290000;let ready=false;while(Date.now()<until){const d=await(await get('/state',h)).json();if(d.control?.reportAvailable){ready=true;break;}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'run timed out');
  const r=await(await get('/results.json',h)).json();console.log(JSON.stringify(r.execution.groups.map(g=>({id:g.path.id,status:g.status,records:g.records.map(x=>({status:x.status,error:x.error,checks:x.checks}))})),null,2));assert.equal(r.execution.groups.filter(g=>g.status==='issue').length,i===1?1:0);assert.ok(r.execution.groups.every(g=>g.records.length===2));assert.equal((await get('/report',h)).status,200);checks.push(i===1?'fault-detected-twice':'normal-retest-passed-twice');
 }
 console.log(JSON.stringify({scope:'local-cloud-entry-api-check',passed:checks},null,2));
}finally{await app.close();}
