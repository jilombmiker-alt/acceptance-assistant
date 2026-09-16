import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask,coverageResults} from './planner.mjs';
import {scopeGuide} from './scope-guide.mjs';
const task=(extra={})=>compileTask({id:'task-scope',goal:'新增书目、保存并导出，不检查视频',normalRuns:2,intake:{fingerprint:'fixture',requirements:[],gaps:[]},observation:{title:'记录工具',url:'http://127.0.0.1:4567/',fields:[],blocked:[],readRules:[]},...extra});
test('an entry-only plan names its actual scope even after all executed checks pass',()=>{
 const t=task(),guide=scopeGuide(t),original=JSON.stringify(t);
 assert.deepEqual(guide.checks.map(c=>c.id),['entry']);
 assert.deepEqual(new Set(guide.uncovered),new Set(['保存','导出']));
 assert.deepEqual(guide.excluded,['视频']);assert.match(guide.boundary,/其他业务流程尚未验证/);
 t.coverage=coverageResults(t,{groups:[{path:{id:'entry'},status:'pass'}]});
 assert.deepEqual(scopeGuide(t),guide);assert.equal(JSON.stringify(task()),original);
});
test('mapping and unread-resource gaps remain actionable without counting them as business failures',()=>{
 const t=task({goal:'检查输入框'});t.gaps.push({kind:'observation',reason:'页面存在未读取的请求或资源'});
 const guide=scopeGuide(t);assert.equal(guide.warnings.length,2);assert.match(guide.warnings[0],/未观察到支持的普通输入框/);
 assert.deepEqual(guide.checks.map(c=>c.id),['entry']);assert.deepEqual(guide.uncovered,[]);
});
test('removed paths are not offered for execution; reviewed business tasks are not relabelled basic',()=>{
 const t=task({excludedPaths:['entry']});assert.equal(scopeGuide(t).checks.length,0);
 assert.match(scopeGuide(t).next,/没有可执行检查/);assert.ok(scopeGuide(t).excluded.includes('页面入口'));
 assert.equal(scopeGuide({...task(),mode:'reviewed-reading'}),null);assert.equal(scopeGuide(null),null);
});
test('known JSON evidence checks do not imply arbitrary export business is covered',()=>{
 const t=task();t.checks.push({id:'report-json',module:'下载：证据'});t.plan.paths.push({id:'report-json'});
 t.coverage.push({module:'下载：证据',status:'planned',checkIds:['report-json']});
 const g=scopeGuide(t);assert.ok(g.checks.some(c=>c.id==='report-json'));assert.ok(g.uncovered.includes('导出'));
});
