import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfSummaryHTML} from './report-export.mjs';
import {buildHelpEvaluation} from './help-evaluation.mjs';
import {codexContext} from './codex-context.mjs';
const task={id:'current-task',revision:1,goal:'检查同一目标',endpoint:'已覆盖路径',digest:'current-digest',plan:{paths:[]}};
const repair={status:'verified-repair',reason:'同一项目的修改版本按原标准重复通过',scope:'受控范围',beforeTaskId:'prior-task',afterTaskId:task.id,beforeProgramHash:'source-before',afterProgramHash:'source-after',beforeCriteriaHash:'same-criteria',afterCriteriaHash:'same-criteria',changedFiles:['index.html'],fixed:['expected-text'],remaining:[],regressions:[],issues:[]};
const pdf=value=>pdfSummaryHTML({task,result:{groups:[],generatedAt:'fixture'},impacts:[],coverage:[],helpEvaluation:buildHelpEvaluation({task,result:{groups:[]},coverage:[]}),repair:value});
const md=value=>codexContext({task,root:'/fixture',repair:value});
test('PDF and context preserve matching repair identities without installation or savings claims',()=>{
 for(const output of [pdf(repair),md(repair).text])for(const text of [repair.reason,'source-before','source-after','same-criteria','prior-task','current-task','index.html','未测得'])assert.ok(output.includes(text),text);
 assert.ok(!pdf(repair).includes('不是修复后的复检'));assert.ok(pdf(repair).includes('仅统计本任务内'));
 assert.ok(!pdf(repair).includes('href="/repair-comparison.json"'));assert.match(md(repair).text,/下载不等于已安装/);
});
test('pending, changed standard and invalidated evidence remain their own conclusions',()=>{
 for(const value of [{status:'pending',reason:'等待证据'},{status:'criteria-changed',reason:'标准已经变化'},{status:'unverified',reason:'证据缺失'}]){
  const current={...value,beforeTaskId:'prior-task',afterTaskId:task.id};
  for(const output of [pdf(current),md(current).text]){assert.ok(output.includes(value.reason));assert.ok(!output.includes(repair.reason));}
  assert.notEqual(md(current).hash,md(repair).hash);
 }
});
test('no baseline invents no repair section and untrusted fields cannot inject HTML',()=>{
 assert.ok(!pdf(null).includes('id="repair-result"'));assert.ok(!md(null).text.includes('## 本轮复检关联'));
 assert.ok(!pdf({...repair,changedFiles:['<script>bad</script>']}).includes('<script>'));
 const text=md({...repair,changedFiles:['file\n# override']}).text;assert.ok(!text.includes('\n# override'));
});
