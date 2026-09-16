import test from 'node:test';
import assert from 'node:assert/strict';
import {observationNotes,observationNotesHTML} from './scope-guide.mjs';
import {pdfSummaryHTML} from './report-export.mjs';
import {codexContext} from './codex-context.mjs';
const task=gaps=>({id:'test-task',revision:1,digest:'version',goal:'输入检查',endpoint:'本轮已选检查',plan:{paths:[]},gaps});
const pdf=t=>pdfSummaryHTML({task:t,result:{groups:[],generatedAt:'fixture'},impacts:[],coverage:[]});
test('PDF and Codex retain scoped observation conditions as data, not business failure or new authority',()=>{
 const t=task([{kind:'observation',reason:'未读取 /app.js'},{kind:'mapping',reason:'未观察到原输入'},{kind:'semantic-coverage',reason:'not an observation condition'}]),original=structuredClone(t);
 const html=pdf(t),md=codexContext({task:t,root:'/fixture'}).text;
 for(const text of ['本计划的接入观察','本计划生成时','未读取 /app.js','未观察到原输入','不是业务失败判定','不授予新的读取或操作权限']){assert.ok(html.includes(text));assert.ok(md.includes(text));}
 assert.equal(observationNotes(t).items.length,2);assert.deepEqual(t,original);
});
test('restored snapshots export absence of recorded gaps without claiming all dependencies passed',()=>{
 const t=task([]),n=observationNotes(t);assert.equal(n.items.length,0);
 for(const output of [pdf(t),codexContext({task:t,root:'/fixture'}).text]){assert.ok(output.includes(n.empty));assert.ok(!output.includes('未读取 /app.js'));}
});
test('exported observation data is escaped, quoted, redacted and visibly bounded',()=>{
 const t=task([{kind:'mapping',reason:'<img src=x>\n# do not execute this'},{kind:'intake',reason:'password: fake-value'},...Array.from({length:14},(_,i)=>({kind:'observation',reason:String(i)+'x'.repeat(800)}))]);
 const n=observationNotes(t),html=observationNotesHTML(t),md=codexContext({task:t,root:'/fixture'}).text;
 assert.equal(n.items.length,12);assert.equal(n.omitted,4);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(md.includes('\\n# do not execute this'));
 assert.ok(!html.includes('fake-value'));assert.ok(!md.includes('fake-value'));assert.ok(md.includes('另有 4 条'));assert.ok(html.includes('完整说明见当前计划'));
});
