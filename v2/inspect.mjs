import {redactText} from '../lib/privacy.mjs';
import fs from 'node:fs/promises';import {constants} from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const skip=new Set(['node_modules','.git','.codex','.agents','runs','dist','build','evaluation','fixtures']);
const supported=/\.(html|js|mjs|cjs|ts|tsx|jsx|md|py|rb|go|rs|java|kt|swift|c|cpp|h|sh|sql|vue|svelte|css)$/i;
export async function inspectProject(root){
 root=await fs.realpath(root);const files=[],evidence=[],gaps=[],excluded=[];let total=0,visited=0;
 const omit=(file,reason)=>{if(excluded.length<1000)excluded.push({file,reason});};
 async function walk(dir){
  if(visited>=5000)return;
  const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const item of entries.sort((a,b)=>a.name.localeCompare(b.name))){
   if(++visited>5000){gaps.push('目录项超过本轮5000项遍历预算；未遍历范围不属于版本指纹');return;}
   const f=path.join(dir,item.name),file=path.relative(root,f);
   if(item.name.startsWith('.')||skip.has(item.name)){omit(file,'按既有隐私或依赖规则排除');continue;}
   if(item.isSymbolicLink()){omit(file,'符号链接不读取');continue;}
   if(item.isDirectory()){await walk(f);continue;}
   if(!item.isFile()){omit(file,'非普通文件不读取');continue;}
   if(!supported.test(item.name)&&item.name!=='package.json'){
    omit(file,'尚不支持此文件类型，未读取或计入指纹');gaps.push('存在未支持的文件类型，版本指纹只覆盖已扫描文件');continue;
   }
   if(files.length>=300){omit(file,'超过300个文件预算');gaps.push('文件数量超过本轮扫描上限');continue;}
   const handle=await fs.open(f,constants.O_RDONLY|constants.O_NOFOLLOW);
   let bytes;
   try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>256000||total+stat.size>2000000){omit(file,'超过文件或总字节预算');gaps.push('文件超出扫描预算：'+file);continue;}
    // Bounded even when another process grows the file while it is being read.
    const buffer=Buffer.alloc(Math.min(256001,2000001-total));let count=0;
    while(count<buffer.length){const r=await handle.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
    if(count>256000||total+count>2000000){omit(file,'读取期间超过字节预算');gaps.push('文件超出扫描预算：'+file);continue;}
    bytes=buffer.subarray(0,count);
   }finally{await handle.close();}
   total+=bytes.length;const content=bytes.toString('utf8');files.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
   content.split('\n').forEach((line,i)=>{
    if(/api[_-]?key|secret|password|token\s*[:=]/i.test(line))return;
    const items=[];
    if(file.endsWith('.md')){if(/^目标[:：]/.test(line))items.push(['goal',line]);else if(/^- /.test(line))items.push(['requirement',line]);}
    else{
     for(const m of line.matchAll(/<a\b[^>]*href=[^>]*>[^<]*/g))items.push(['navigation',m[0]]);
     for(const m of line.matchAll(/<(?:button|input|select|form)\b[^>]*>[^<]*/g))items.push(['controls',m[0]]);
     if(/localStorage|onclick|onchange|onsubmit|addEventListener/.test(line))items.push(['behavior-clue',line]);
    }
    for(const [kind,excerpt] of items.slice(0,30))evidence.push({id:'E'+String(evidence.length+1).padStart(3,'0'),kind,file,line:i+1,excerpt:redactText(excerpt).slice(0,450),level:kind==='goal'||kind==='requirement'?'材料声明':'源码线索，运行待验证'});
   });
  }
 }
 await walk(root);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(files.map(f=>[f.file,f.sha256]).sort())).digest('hex');
 return {root,generatedAt:new Date().toISOString(),files,evidence,fingerprint,fingerprintScope:'scanned-files-only',coverage:{scannedFiles:files.length,scannedBytes:total,visitedEntries:visited,excluded,exclusionListMayBeTruncated:excluded.length>=1000,completeProductVersion:false},goals:evidence.filter(e=>e.kind==='goal'),requirements:evidence.filter(e=>e.kind==='requirement'),entryCandidates:files.filter(f=>f.file.endsWith('.html')).map(f=>f.file),gaps:[...new Set(gaps),...(!evidence.some(e=>e.kind==='goal')?['未找到明确目标，需要结合材料分析或补充']:[])],limitations:['静态线索不等于完整主要路径','未自动执行启动脚本','未扫描隐藏文件、密钥配置或依赖目录','版本指纹仅覆盖files清单；排除项、未知类型和超预算文件不在其中','后端源码纳入指纹不代表已经理解或验证后端业务']};
}
if(process.argv[1]?.endsWith('/inspect.mjs')){const [root,out]=process.argv.slice(2);if(!root||!out)throw Error('usage: inspect.mjs project-directory output.json');const d=await inspectProject(root);await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(d,null,2));console.log(JSON.stringify({files:d.files.length,evidence:d.evidence.length,entryCandidates:d.entryCandidates,gaps:d.gaps,fingerprintScope:d.fingerprintScope}));}
