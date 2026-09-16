import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startWorkbench} from '../v3/workbench.mjs';
import {browserEngine} from '../lib/browser.mjs';

const run=promisify(execFile),out=path.resolve(process.argv[2]||'state/completion-tooling');await fs.mkdir(out,{recursive:true});
const app=await startWorkbench({allowedRoot:out,stateDir:path.join(out,'state')});
const token=(await(await fetch(app.origin+'/connect')).text()).match(/data-task-token="([a-f0-9]+)"/)[1];
const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
async function post(route,data){const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Task-Token':token},body:JSON.stringify(data)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
try{
 const spec={schemaVersion:1,project:'工具联通样例',goal:'入口可用',completeContract:true,paths:[{id:'entry',name:'页面入口',dimension:'业务逻辑',trigger:'打开页面',basis:['独立答案：页面主体可见'],steps:[{type:'goto',path:'/index.html'}],checks:[{type:'visible',target:{css:'body'},expected:true,label:'页面主体可见'}]}]};
 const imported=await post('/import-project',{files:[file('index.html','<meta charset="utf-8"><h1>工具联通样例</h1>'),file('acceptance.spec.json',JSON.stringify(spec))]});
 const state=await post('/prepare',{projectPath:imported.projectPath,url:imported.url,mode:'basic',goal:'检查当前交付',normalRuns:2});assert.equal(state.task.mode,'project-contract');
 const browser=await(await browserEngine()).launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.origin+'/workbench');await page.waitForFunction(()=>document.querySelector('#task')?.hidden===false,{timeout:8000}).catch(()=>{});assert.deepEqual(errors,[]);assert.equal(await page.locator('#task').getAttribute('hidden'),null,'任务计划没有在前台显示');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);await page.screenshot({path:path.join(out,'contract-plan.png'),fullPage:true});}finally{await browser.close();}
 const context=await run(process.execPath,['scripts/codex-context.mjs','--url',app.origin],{cwd:path.resolve('.')});assert.match(context.stdout,/契约目标：入口可用/);assert.match(context.stdout,/本计划的接入观察/);
 const draft=path.join(out,'study-draft.json');await run(process.execPath,['scripts/evaluate-help-pair.mjs','--init-local',app.origin,draft],{cwd:path.resolve('.')});const study=JSON.parse(await fs.readFile(draft));assert.equal(study.completeRubric,true);assert.equal(study.criteria.length,1);
 const impactResponse=await fetch(app.origin+'/experience-impact.json');assert.equal(impactResponse.status,200);const impact=await impactResponse.json();assert.equal(impact.tasks,0);assert.equal(impact.humanBenefit.status,'unmeasured');
 const skill=await fs.readFile(path.resolve('.agents/skills/acceptance-assistant/SKILL.md'),'utf8');assert.match(skill,/^---\nname: acceptance-assistant\ndescription: .+\n---/);assert.match(skill,/npm run codex:context/);
 const summary={ui:{mobileScreenshot:'contract-plan.png',horizontalOverflow:false},codexContext:{verified:true,bytes:Buffer.byteLength(context.stdout)},studyDraft:{verified:true,completeRubric:study.completeRubric,criteria:study.criteria.length},experienceImpact:{verified:true,tasks:impact.tasks,humanBenefit:impact.humanBenefit.status},skill:{structureVerified:true,officialValidator:'not-run: PyYAML unavailable in bundled Python'},limitations:['Study draft is infrastructure, not human outcome data','No global Codex skill was installed','The helper reads localhost only']};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await app.end();await app.close();}
