import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWorkbench} from '../v3/workbench.mjs';

const out=path.resolve(process.argv[2]||'state/independent-contracts');await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({allowedRoot:out,stateDir:path.join(out,'state')});
const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1];
const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
const contract=(project,paths)=>JSON.stringify({schemaVersion:1,project,goal:'完成此项目声明的交付验收',completeContract:true,paths});
const entry={id:'entry',name:'页面入口',dimension:'业务逻辑',trigger:'打开页面',basis:['独立答案：入口应可见'],steps:[{type:'goto',path:'/index.html'}],checks:[{type:'visible',target:{css:'body'},expected:true,label:'页面主体可见'}]};
const fixtures=[
 {id:'task-list',answer:{entry:'pass',add:'pass'},files:[
  file('index.html','<meta charset="utf-8"><label>任务名称<input id="name"></label><button id="add">新增</button><ul id="items"></ul><script>document.getElementById("add").onclick=()=>{document.getElementById("items").innerHTML+=`<li>${document.getElementById("name").value}</li>`}</script>'),
  file('acceptance.spec.json',contract('陌生任务清单',[entry,{id:'add',name:'新增任务',dimension:'数据正确性',trigger:'填写名称并新增',basis:['独立答案：新增后列表显示名称'],dependsOn:['entry'],steps:[{type:'goto',path:'/index.html'},{type:'fill',target:{label:'任务名称'},value:'验收任务'},{type:'click',target:{css:'#add'}}],checks:[{type:'containsText',target:{css:'#items'},expected:'验收任务',label:'列表显示新增任务'}]}]))]},
 {id:'inventory',answer:{entry:'pass',total:'issue'},files:[
  file('index.html','<meta charset="utf-8"><h1>库存</h1><p id="summary">库存 1 项</p>'),
  file('acceptance.spec.json',contract('陌生库存页',[entry,{id:'total',name:'库存总数',dimension:'数据正确性',trigger:'打开库存摘要',basis:['独立答案：交付样本应显示库存 2 项'],dependsOn:['entry'],steps:[{type:'goto',path:'/index.html'}],checks:[{type:'text',target:{css:'#summary'},expected:'库存 2 项',label:'库存总数与独立答案一致'}]}]))]},
 {id:'broken-form',answer:{entry:'pass',save:'unverified'},files:[
  file('index.html','<meta charset="utf-8"><label>名称<input id="name"></label><p>保存按钮尚未接入</p>'),
  file('acceptance.spec.json',contract('陌生资料表单',[entry,{id:'save',name:'保存资料',dimension:'交互反馈',trigger:'填写后点击保存',basis:['独立答案：保存按钮必须存在并给出完成状态'],dependsOn:['entry'],steps:[{type:'goto',path:'/index.html'},{type:'fill',target:{label:'名称'},value:'示例资料'},{type:'click',target:{role:'button',name:'保存'}}],checks:[{type:'containsText',target:{css:'body'},expected:'保存完成',label:'页面反馈保存完成'}]}]))]}
];
async function post(route,data){const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
const records=[];
try{
 for(const fixture of fixtures){
  const imported=await post('/import-project',{files:fixture.files});assert.equal(imported.hasAcceptanceContract,true);
  let state=await post('/prepare',{projectPath:imported.projectPath,url:imported.url,mode:'basic',goal:'按项目验收契约检查本次交付',normalRuns:2});
  assert.equal(state.task.mode,'project-contract');assert.equal(state.task.contract.declaredComplete,true);
  state=await post('/start',{taskId:state.task.id,revision:state.task.revision,digest:state.task.digest,confirmed:true});await app.wait();
  const results=await(await fetch(app.origin+'/results.json')).json(),actual=Object.fromEntries(results.execution.groups.map(group=>[group.path.id,group.status]));
  assert.deepEqual(actual,fixture.answer);records.push({id:fixture.id,expected:fixture.answer,actual,matched:true,paths:Object.keys(actual).length});
 }
 const total=records.reduce((n,row)=>n+row.paths,0),summary={scope:'Three held-out local static projects with project-owned contracts and separately fixed expected statuses',projects:records.length,paths:total,exactMatches:total,falsePositive:0,falseNegative:0,unverifiedCorrectlyRetained:1,records,limitations:['Controlled fixtures are not external customer projects','The project contract declares coverage; this audit does not prove every real requirement was listed','No human time or long-term usage measured']};
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await app.end();await app.close();}
