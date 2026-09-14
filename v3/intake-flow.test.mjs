import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {connectJS} from './connect-page.mjs';
import {chatJS} from './chat-entry.mjs';
function intake({failPrepare=false,storageBlocked=false}={}){
 const bytes=Uint8Array.from(Buffer.from('<h1>Test</h1>'));
 const elements=Object.fromEntries(['connect','folder','goal','expected','import','result','status'].map(id=>[id,{value:'',disabled:false}]));
 elements.goal.value='检查页面';elements.folder.files=[{webkitRelativePath:'site/index.html',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];
 const calls=[],location={href:''};let failures=failPrepare?1:0;
 const context={document:{currentScript:{dataset:{taskToken:'local-test'}},getElementById:id=>elements[id]},sessionStorage:{getItem:()=>null,setItem:()=>{if(storageBlocked)throw Error('storage blocked');}},location,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(route,options)=>{calls.push({route,body:JSON.parse(options.body)});const failed=route==='/prepare'&&failures-->0;return {ok:!failed,json:async()=>failed?{error:'本轮尚未生成，请修改目标再试'}:route==='/import-project'?{projectPath:'/local/snapshot',url:'http://127.0.0.1:1234/',files:1}:{task:{id:'new-task'}}};}};
 vm.runInNewContext(connectJS,context);
 return {elements,calls,location,submit:()=>elements.connect.onsubmit({preventDefault(){}})};
}
test('blank goals fail before any upload and restore form controls',async()=>{
 const h=intake();h.elements.goal.value='   ';await h.submit();assert.equal(h.calls.length,0);assert.match(h.elements.status.textContent,/不能只填写空格/);assert.equal(h.elements.folder.disabled,false);
});
test('retry after a planning failure reuses the uploaded project; new selection imports anew',async()=>{
 const h=intake({failPrepare:true});await h.submit();assert.match(h.elements.status.textContent,/尚未生成/);assert.equal(h.elements.goal.disabled,false);
 h.elements.goal.value='检查手机适配';await h.submit();assert.equal(h.calls.filter(c=>c.route==='/import-project').length,1);assert.equal(h.calls.filter(c=>c.route==='/prepare').length,2);assert.equal(h.calls.at(-1).body.goal,'检查手机适配');assert.equal(h.location.href,'/');
 h.elements.folder.onchange();await h.submit();assert.equal(h.calls.filter(c=>c.route==='/import-project').length,2);
});
test('blocked optional browser storage does not turn successful intake into a failure',async()=>{
 const h=intake({storageBlocked:true});await h.submit();assert.equal(h.location.href,'/');assert.equal(h.calls.length,2);
});
function chat({available=true,kind='snapshot'}={}){
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',addEventListener(){}});return elements.get(id);};
 const state={resumeDraft:{kind,available},task:{id:'task-test',revision:1,goal:'检查页面',plan:{project:'Test'},checks:[],excludedPaths:[]},coverage:[],impacts:[]};const calls=[];
 const context={el,state,busy:false,esc:String,MutationObserver:class{observe(){}},post:async(...args)=>calls.push(args),experienceId:''};
 vm.createContext(context);vm.runInContext(chatJS,context);vm.runInContext('renderChat()',context);
 return {el,calls,submit:()=>el('chat-form').onsubmit({preventDefault(){}})};
}
test('a fresh page restores the current plan without relying on browser storage',()=>{const h=chat();assert.match(h.el('chat-answer').innerHTML,/id="chat-start"/);});
test('snapshot retest guides reimport instead of submitting the old version again',async()=>{const h=chat();h.el('project-path').value='/snapshot';h.el('url').value='http://127.0.0.1:1234/';h.el('chat-input').value='重新检查';await h.submit();assert.equal(h.calls.length,0);assert.match(h.el('chat-answer').innerHTML,/重新选择文件夹/);});
test('after restart an unavailable snapshot prompts reimport instead of showing a start button',()=>{const h=chat({available:false});assert.match(h.el('chat-answer').innerHTML,/网页服务已停止/);assert.doesNotMatch(h.el('chat-answer').innerHTML,/id="chat-start"/);});
