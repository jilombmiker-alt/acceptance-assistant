import {browserEngine} from '../lib/browser.mjs';
import {sanitize,sensitiveTarget} from '../lib/privacy.mjs';
import {bodyHash} from '../lib/authorization.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveReportJourneys} from './report-journeys.mjs';

export function localURL(value){
 const u=new URL(value);
 if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('本轮入口仅支持无账号信息的本机 HTTP 页面');
 if(u.search||u.hash)throw Error('当前入口不支持查询参数或页面片段，请使用明确的本地页面路径');
 return u;
}
export function readRules(url,intake){
 const u=localURL(url),paths=new Set([u.pathname]);
 const folder=new URL('./',u);
 for(const f of intake.files)if(/\.(js|mjs|css)$/i.test(f.file)){paths.add('/'+f.file);paths.add(new URL(f.file,folder).pathname);}
 return [...paths].map((p,i)=>({id:'read-'+i,origin:u.origin,method:'GET',pathPattern:p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),bodyHashes:[bodyHash('')]}));
}
export async function discoverPage(url,intake,{semanticTargets=false}={}){
 const u=localURL(url),rules=readRules(url,intake);
 const entryFile=intake.files.find(f=>'/'+f.file===u.pathname||u.pathname==='/'&&f.file==='index.html');
 if(entryFile){
  const content=await fs.readFile(path.join(intake.root,entryFile.file));
  if(bodyHash(content)!==entryFile.sha256)throw Error('页面源码在读取后发生变化，请重新规划');
  for(const match of content.toString('utf8').matchAll(/(?:src|href)=["']([^"']+)["']/g)){
   const asset=new URL(match[1],u);
   if(asset.origin!==u.origin||!asset.search||[...asset.searchParams].some(([k,v])=>!['v','p0','version','rev'].includes(k)||!/^[a-zA-Z0-9._-]{1,32}$/.test(v)))continue;
   const rule=rules.find(r=>new RegExp('^(?:'+r.pathPattern+')$').test(asset.pathname));if(rule)rule.allowedQueries=[...new Set([...(rule.allowedQueries||[]),asset.search])];
  }
 }
 const browser=await(await browserEngine()).launch({headless:true});
 const blocked=[];
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1200,height:850}});
  await context.route('**/*',async route=>{
   const r=route.request(),v=new URL(r.url());
   if(v.origin===u.origin&&r.method()==='GET'&&rules.some(x=>new RegExp('^(?:'+x.pathPattern+')$').test(v.pathname)&&(!v.search||x.allowedQueries?.includes(v.search))))await route.continue();
   else{if(blocked.length<50)blocked.push({method:r.method(),path:v.origin===u.origin?v.pathname:'外部目标（未访问）'});await route.abort();}
  });
  await context.routeWebSocket('**/*',ws=>ws.close());
  const page=await context.newPage();await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:10000});
  const observation=await page.evaluate(semanticTargets=>{
   const visible=e=>{for(let n=e.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS'&&!n.open&&![...n.children].find(c=>c.tagName==='SUMMARY')?.contains(e))return false;return e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';};
   const selector=e=>{if(e.id&&document.querySelectorAll('#'+CSS.escape(e.id)).length===1)return '#'+CSS.escape(e.id);let bits=[];for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const tag=n.tagName.toLowerCase(),index=[...n.parentElement.children].filter(x=>x.tagName===n.tagName).indexOf(n)+1;bits.unshift(tag+':nth-of-type('+index+')');}return 'html > '+bits.join(' > ');};
   const name=e=>(e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.getAttribute('placeholder')||e.textContent||'').trim().slice(0,160);
   const openers=e=>{const a=[];for(let n=e.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS'&&!n.open){const s=[...n.children].find(x=>x.tagName==='SUMMARY');if(s)a.unshift({css:selector(s)});}return a;};
   const disclosures=[...document.querySelectorAll('details')].slice(0,12).flatMap(d=>{const s=[...d.children].find(x=>x.tagName==='SUMMARY'),body=[...d.children].find(x=>x.tagName!=='SUMMARY');if(!s||!body)return [];return [{label:name(s),summary:{css:selector(s)},body:{css:selector(body)},openers:[...openers(d),...(d.open?[{css:selector(s)},{css:selector(s)}]:[{css:selector(s)}])]}];});
   const documentLinks=[...document.querySelectorAll('a[href]')].filter(e=>/\.json(?:$|[?#])/.test(e.getAttribute('href'))).slice(0,12).map(e=>({label:name(e),target:{css:selector(e)},href:e.href,download:e.hasAttribute('download'),newWindow:e.target==='_blank',openers:openers(e)}));
   return {reportRaw:{disclosures,documentLinks},observedTargets:semanticTargets?[...document.querySelectorAll('h1,h2,h3,p,li,summary,label,[id]')].filter(e=>!['SCRIPT','STYLE','INPUT','TEXTAREA','SELECT'].includes(e.tagName)).slice(0,60).map((e,i)=>({id:'target-'+i,target:{css:selector(e)},tag:e.tagName,disclosureBody:!!e.closest('details')&&!['DETAILS','SUMMARY'].includes(e.tagName),text:e.textContent.trim().slice(0,240),visible:visible(e)})):[],title:document.title.slice(0,160),headings:[...document.querySelectorAll('h1,h2')].filter(visible).slice(0,25).map(e=>({name:name(e),target:{css:selector(e)}})),fields:[...document.querySelectorAll('input,textarea')].filter(visible).slice(0,30).map(e=>({name:name(e),target:{css:selector(e)},type:e.type,nameAttribute:e.name,required:e.required,disabled:e.disabled,readOnly:e.readOnly})),buttons:[...document.querySelectorAll('button,a')].filter(visible).slice(0,50).map(e=>({name:name(e),target:{css:selector(e)},tag:e.tagName})),bodyPresent:!!document.body};
  },semanticTargets);
  const resolved=await resolveReportJourneys(observation.reportRaw,{url:u.href,root:intake.root});delete observation.reportRaw;observation.reportJourneys=resolved.journeys;observation.reportGaps=resolved.gaps;
  observation.observedTargets=observation.observedTargets.filter(x=>!sensitiveTarget(x.target)&&!sensitiveTarget({label:x.text}));
  observation.fields=observation.fields.filter(f=>!sensitiveTarget(f)&&['text','textarea','email','search','url','tel'].includes(f.type)&&!f.disabled&&!f.readOnly);
  return sanitize({...observation,url:u.href,observedAt:new Date().toISOString(),blocked,readRules:rules,scope:'只读取选定页面及扫描到的脚本样式；不提交、不调用模型、不访问外部目标'});
 }finally{await browser.close();}
}
