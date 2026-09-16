// A single conversation surface over the existing task actions.
export function chatPage(html){
 const status=html.match(/<p id="message"[\s\S]*?<\/p>/)?.[0]||'';
 return html.replace('<body id="top" data-light>','<body id="top" data-light data-chat>')
  .replace(status,'').replace('<main>','<main hidden>')
  .replace('</main>','</main><main id="chat-home"><div class="chat-mark" aria-hidden="true"></div><h1>说说你想完成什么。</h1><div id="chat-thread" hidden><p id="chat-user"></p><div id="chat-answer" aria-live="polite"></div></div><form id="chat-form"><label for="chat-input" class="visually-hidden">你的目标或问题</label><textarea id="chat-input" rows="3" maxlength="2000" required placeholder="写下目标，或告诉我哪里需要改。"></textarea><div class="chat-bottom"><span id="chat-hint">写目标 → 检查 → 修复复检 <button type="button" id="chat-help" disabled>怎么开始</button></span><button id="chat-send" type="submit" disabled aria-label="发送" title="发送"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"/></svg></button></div></form>'+status+'<p class="project-entry"><a href="/connect">检查我的产品 / 选择代码文件夹</a><span id="connected-project"></span></p><noscript>请启用 JavaScript 后发送目标。</noscript></main>');
}

export const chatCSS=`
body[data-chat]{--ink:#111;--muted:#666;--line:#ddd;--paper:#fff;--accent:#111;background:#fff;color:#111;min-height:100svh;caret-color:#111}
body[data-chat] ::selection{background:#111;color:#fff}
body[data-chat] #chat-home{width:100%;max-width:744px;min-height:100svh;margin:0 auto;padding:clamp(100px,22vh,220px) 32px 56px}
.chat-mark{width:32px;height:6px;background:#111;margin-bottom:24px}
body[data-chat] #chat-home h1{font-size:30px;font-weight:750;letter-spacing:-.03em;line-height:1.4;margin:0 0 36px;color:#111}
body[data-chat] #chat-form{display:block;border:2px solid #111;border-radius:0;background:#fff;padding:22px 24px 18px;margin:0}
body[data-chat] #chat-form:focus-within{outline:1px solid #111;outline-offset:4px}
body[data-chat] #chat-input{display:block;width:100%;min-height:104px;padding:0;border:0;border-radius:0;resize:vertical;background:#fff;color:#111;font-size:17px;line-height:1.75;box-shadow:none;outline:none}
body[data-chat] #chat-input::placeholder{color:#666;opacity:1}
.chat-bottom{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:16px}
#chat-hint{color:#666;font-size:12px;line-height:1.5}body[data-chat] #chat-help{display:inline;padding:0;margin-left:10px;min-height:44px;border:0;background:none;color:#111;font-size:12px;font-weight:600;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
body[data-chat] #chat-send{display:flex;align-items:center;justify-content:center;width:46px;height:46px;min-height:46px;padding:0;border:2px solid #111;border-radius:0;background:#111;color:#fff;flex-shrink:0}
body[data-chat] .project-entry{margin-top:20px;font-size:14px}body[data-chat] .project-entry a{color:#111;display:inline-block;min-height:44px}#connected-project{display:block;font-size:12px;color:#666;overflow-wrap:anywhere}
body[data-chat] #chat-send:hover{background:#fff;color:#111}
body[data-chat] #chat-send:disabled{opacity:.4;cursor:wait}
body[data-chat] :focus-visible{outline:3px solid #111;outline-offset:4px}
body[data-chat] #message{margin:16px 0 0;min-height:0;font-size:14px;color:#555}
body[data-chat] #message:empty{display:none}
body[data-chat] #message.error{color:#111;font-weight:650}
#chat-thread{margin:0 0 32px;overflow-wrap:anywhere}#chat-user{color:#666;margin:0 0 22px;font-size:14px;white-space:pre-wrap}
#chat-answer{font-size:16px;line-height:1.8}#chat-answer p{margin:0 0 12px}#chat-answer a{color:#111;font-size:14px;display:inline-block;margin:6px 20px 6px 0;text-decoration-thickness:2px;text-underline-offset:5px}#chat-answer details{margin:8px 0}#chat-answer summary{font-size:14px;font-weight:500}#chat-answer ul{padding-left:20px;font-size:14px}
body[data-chat] #chat-answer button{background:#111;color:#fff;border:2px solid #111;border-radius:0;font-size:14px;margin:8px 0}
body[data-chat] #chat-answer button:hover{background:white;color:#111}
@media(max-width:640px){body[data-chat] #chat-home{padding:100px 24px 32px}body[data-chat] #chat-home h1{font-size:25px;margin-bottom:28px}.chat-mark{width:28px;height:5px;margin-bottom:22px}body[data-chat] #chat-form{padding:20px 18px 16px}body[data-chat] #chat-input{font-size:16px;min-height:116px}#chat-hint{font-size:11px}body[data-chat] #chat-home:has(#chat-thread:not([hidden])){padding-top:44px}}
`;

export const chatJS=String.raw`
let chatInitialized=false,chatActive=false,chatView='task',chatResultKey='',chatCustomBusy=false;
function chatAnswer(html){el('chat-thread').hidden=false;el('chat-answer').innerHTML=html;}
function scopeGuideText(){
 const guide=state.scopeGuide;if(!guide)return '';
 return '<p>'+esc(guide.boundary)+(guide.uncovered.length?' 尚未对应：'+esc(guide.uncovered.join('、'))+'。':'')+'</p>'+(guide.warnings.length?'<p>'+esc(guide.warnings[0])+'</p>':'');
}
function renderChat(){
 if(!el('chat-home'))return;
 el('connected-project').textContent=state?.resumeDraft?'当前项目：'+(state.task?.plan?.project||'已接入网页')+(state.resumeDraft.kind==='snapshot'?' · 修改源码后，重新选择文件夹接入新版本。':' · 修改源码后，在这里输入“重新检查”。'):'未接入个人项目。先选择文件夹，再写检查目标。';
 if(!chatInitialized&&state){chatInitialized=true;chatActive=!!state.task;chatView='task';}
 el('chat-send').disabled=busy||chatCustomBusy||!state;el('chat-help').disabled=busy||chatCustomBusy||!state;
 if(!chatActive||chatView!=='task'||!state.task)return;
 const key=JSON.stringify([state.task.id,state.task.revision,state.automatic,state.impacts,state.control?.worker?.phase,state.control?.control?.status,state.control?.reportAvailable,state.coverage,state.repair,state.businessAdvice,state.executionCounts,state.resumeDraft?.available]);
 if(key===chatResultKey)return;chatResultKey=key;
 const t=state.task,s=state.control,ready=s?.reportAvailable,issues=state.impacts||[];
 if(state.resumeDraft?.kind==='snapshot'&&!state.resumeDraft.available&&!state.receipt){chatAnswer('<p>本地助手已重启，之前的网页服务已停止。'+(state.snapshotRepairAvailable?'原标准仍保留。请重新选择文件夹，勾选同项目复检，再开始本轮检查。':'请重新选择文件夹接入，再生成本轮检查。')+'</p><a href="/connect">重新选择文件夹</a>');return;}
 if(s?.worker?.running||s?.worker?.phase==='starting'){chatAnswer('<p>正在检查。完成后会告诉你先改哪里。</p><a href="/workbench#execution">查看进度或暂停</a>');return;}
 if(ready){
  const basicIssues=[...new Set((state.coverage||[]).filter(r=>r.status==='issue').flatMap(r=>r.checkIds))];
  const failed=(state.automatic?.decisions||[]).find(d=>d.outcome==='requirement-not-met');
  const needsExecutionCheck=state.businessAdvice?.some(a=>a.kind==='execution-incomplete'||a.blockers?.some(b=>b.kind==='execution-incomplete'));
  const counts=state.executionCounts;const incomplete=counts&&(counts.blocked||counts.unverified)?'<p>依赖受阻 '+counts.blocked+' 条路径，执行未完成 '+counts.unverified+' 条路径；这些路径尚未验证通过。</p>':'';
  chatAnswer('<p>'+(issues.length?'先处理这 '+issues.length+' 项偏差。'+(failed?esc(failed.summary):'打开证据，按位置修复问题。'):('本轮已结束，已覆盖检查发现 '+basicIssues.length+' 项问题。尚未覆盖的目标请在报告中核对。'))+'</p>'+scopeGuideText()+incomplete+(state.businessAdvice?.length?'<p>下一步：'+esc(state.businessAdvice[0].next)+'</p><details><summary>为什么这样建议</summary><p>'+esc(state.businessAdvice[0].impact)+'</p><p>'+esc(state.businessAdvice[0].unknown)+'</p><p>'+esc(state.businessAdvice[0].recheck)+'</p><p>可输入“采纳建议：说明”“拒绝建议：原因”或“纠正建议：要求”。记录选择不会算作建议有效。</p></details>':'')+(state.repair?'<p>复检：'+esc(state.repair.reason)+'</p>'+(state.repair.progress?'<p>'+esc(state.repair.progress.message)+'</p>':'')+(state.repair.beforeReportURL?'<a href="'+esc(state.repair.beforeReportURL)+'">查看上轮问题与证据</a>':'')+'<a href="/repair-comparison.json" download>下载复检关联记录</a>':'')+'<p>'+(state.resumeDraft?.kind==='snapshot'?'修改源码后，重新选择文件夹接入新版本，再按原目标复检。':needsExecutionCheck?'先核对检查条件和定位依据；需要复查时，在这里输入“重新检查”。':'修改原目录中的代码后，保持运行地址不变，在这里输入“重新检查”。')+'</p><a href="/report">查看问题与证据</a><a href="/codex-context.md" download>把修改要求带回 Codex</a>');
 }else if(state.receipt){chatAnswer('<p>本轮尚未取得完整结果。先查看当前进度，再继续检查。</p><a href="/workbench#execution">继续处理本轮</a>');}
 else{
  const reminders=(state.automatic?.decisions||[]).filter(d=>d.decision==='apply');
  chatAnswer('<p>'+(state.scopeGuide?'本轮可执行 '+state.scopeGuide.checks.length+' 项网页检查：'+esc(state.scopeGuide.checks.slice(0,3).map(c=>c.name).join('、'))+(state.scopeGuide.checks.length>3?'等':'')+'。':'接下来检查“'+esc(t.goal)+'”，本轮有 '+t.checks.filter(c=>!t.excludedPaths.includes(c.id)).length+' 项可执行检查。')+(reminders.length?'会一并核对：'+esc(reminders[0].summary):'')+'</p>'+scopeGuideText()+'<details><summary>查看本次检查范围</summary><p>'+esc(t.limitations)+'</p><ul>'+t.checks.filter(c=>!t.excludedPaths.includes(c.id)).map(c=>'<li>'+esc(c.module)+'：'+esc(c.expected)+'</li>').join('')+'</ul>'+ (state.scopeGuide?.excluded.length?'<p>本轮已排除：'+esc(state.scopeGuide.excluded.join('、'))+'。</p>':'')+'</details>'+(state.scopeGuide&&!state.scopeGuide.checks.length?'<p>'+esc(state.scopeGuide.next)+'</p><a href="/workbench">调整检查范围</a>':'<button type="button" id="chat-start">'+(state.scopeGuide?'开始这些检查':'开始检查')+'</button>'));
  if(el('chat-start'))el('chat-start').onclick=()=>post('/start',{confirmed:true,digest:state.task.digest});
 }
}
if(el('chat-home')){
 const oldMessage=el('message');new MutationObserver(()=>{el('chat-send').disabled=busy||chatCustomBusy||!state;}).observe(oldMessage,{childList:true,subtree:true});
 el('chat-help').onclick=()=>{el('chat-input').value='怎么做';el('chat-form').requestSubmit();};
 el('chat-form').onsubmit=async e=>{
  e.preventDefault();if(busy||chatCustomBusy||!state)return;
  const text=el('chat-input').value.trim();if(!text)return;
  chatActive=true;chatView='custom';chatResultKey='';el('chat-user').textContent=text;el('chat-input').value='';el('message').textContent='';
  if(/^(怎么做|怎么用|帮助|使用指南)[？?。！!]*$/.test(text)){
   chatAnswer('<p>先点下方“检查我的产品”，选择网页文件夹，再写目标，例如：检查输入框和手机适配。</p><p>生成计划后点“开始这些检查”。修复快照项目后，重新选择文件夹；使用原目录和运行地址的项目，可输入“重新检查”。</p><p>想先体验，输入“查看案例”。换项目输入“设置项目”；留意见用“纠正：具体要求”。</p><a href="/guide-video">看 3 分半使用演示</a>');return;
  }
  if(/^(设置项目|项目设置|换项目|上传代码|上传产品|检查我的产品)[。！!]*$/.test(text)){
   chatAnswer('<p>选择网页代码文件夹即可自动接入；已经启动的项目也可以填写地址。</p><a href="/connect">检查我的产品</a>');return;
  }
  if(/^(查看案例|看看案例|案例|展示案例)[。！!]*$/.test(text)){
   chatCustomBusy=true;el('chat-send').disabled=true;chatAnswer('<p>正在读取案例…</p>');
   try{const r=await fetch('/repair-case.json');if(!r.ok)throw Error('案例暂时无法读取，请稍后重试。');const d=await r.json();chatAnswer('<p>'+esc(d.flow)+'</p><p>修复前 '+d.before.issues+' 项偏差，修复后 '+d.after.issues+' 项。相同 '+d.criteria.length+' 项检查，各重复 '+d.repetitions+' 次。</p><p>这是独立修复实测，人工时间节省尚未测得。</p><a href="/repair-case.json" download>查看案例记录</a>');}catch(err){chatAnswer('<p>'+esc(err.message)+'</p>');}finally{chatCustomBusy=false;renderChat();}return;
  }
  if(/^(带回\s*Codex|Codex|导出上下文)$/i.test(text)){
   chatAnswer(state.task?'<p>下载后，把文件附到 Codex 的下一条任务里，再说明你这次想修改什么。</p><a href="/codex-context.md" download>下载项目上下文</a>':'<p>先写下这次想完成的目标，生成计划后再导出。</p>');return;
  }
  if(/^(继续|下一步|查看结果|查看报告)[。！!]*$/.test(text)&&state.task){chatView='task';renderChat();return;}
  const adviceFeedback=text.match(/^(采纳建议|拒绝建议|纠正建议)[：:]\s*([\s\S]+)$/);
  if(adviceFeedback){
   const item=state.businessAdvice?.[0];if(!item){chatAnswer('<p>本轮还没有可反馈的业务建议。先完成检查，再查看下一步。</p>');return;}
   const count=state.opinions.length;await post('/opinion',{text:adviceFeedback[2],adviceId:item.id,adviceDecision:({'采纳建议':'accept','拒绝建议':'reject','纠正建议':'correct'})[adviceFeedback[1]]});
   chatAnswer(state.opinions.length>count?'<p>已保存本轮建议反馈。采纳不等于有效；实际修改和原标准复检仍需分别验证。</p><p>输入“查看结果”可回到当前建议。</p>':'<p>反馈尚未保存，请按下方提示处理。</p>');return;
  }
  const correction=text.match(/^(?:纠正|记住)[：:]\s*([\s\S]+)$/);
  if(correction){if(!state.task){chatAnswer('<p>先写下本次目标。建立任务后，我才能把这条纠正记到对应项目。</p>');return;}const count=state.opinions.length;await post('/opinion',{text:correction[1]});chatAnswer(state.opinions.length>count?'<p>已记到本项目。下一轮会重新判断它是否适用。</p>':'<p>这条纠正还没有保存，请按下方提示重试。</p>');return;}
  if(!el('project-path').value||!el('url').value){chatAnswer('<p>先告诉我需要检查哪个项目。</p><a href="/connect">选择我的代码文件夹</a>');return;}
  if(/^重新检查[。！!]*$/.test(text)&&state.resumeDraft?.kind==='snapshot'){chatAnswer('<p>当前检查的是上次导入的快照。请重新选择文件夹接入修改后的代码，再按原目标复检。</p><a href="/connect">重新选择文件夹</a>');return;}
  const goal=/^重新检查[。！!]*$/.test(text)&&state.task?state.task.goal:text;
  el('goal').value=goal;chatAnswer('<p>正在整理下一步…</p>');
  const previous=state.task?.id;
  await post('/prepare',{contextNote:el('context-note').value,automatic:el('auto-personal').checked&&!el('auto-personal').disabled,materialFiles:el('material-files').value.split('\n').map(x=>x.trim()).filter(Boolean),experienceId,mode:el('mode').value,projectPath:el('project-path').value,url:el('url').value,goal,endpoint:el('endpoint').value,expectedText:el('expected').value,normalRuns:Number(el('runs').value)});
  if(state.task?.id!==previous){chatView='task';chatResultKey='';el('message').textContent='';renderChat();}
  else chatAnswer('<p>这次还没有生成新计划。按下方提示处理后，再发送一次。</p><a href="/workbench">查看当前任务</a>');
 };
 el('chat-input').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();el('chat-form').requestSubmit();}});
}
`;
