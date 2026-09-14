import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticProject} from '../v2/static-server.mjs';

// Local-only intake. Never install dependencies or execute a package/start script.
export const importLimits={files:300,fileBytes:256000,totalBytes:2000000};
export function importable(file){
 return typeof file==='string'&&file.length<=240&&!file.includes('\\')&&!file.startsWith('/')&&
  !file.split('/').some(s=>!s||s.startsWith('.')||/^(node_modules|coverage|state|runs|evaluation|fixtures)$/i.test(s))&&
  !/(?:secret|credential|token|password|private|个人|能力梯度|意图流)/i.test(file)&&
  /\.(html|css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(file)&&
  !/(?:^|\/)(?:package(?:-lock)?|credentials|secrets|config)\.json$/i.test(file);
}
export async function importStaticProject(files,directory){
 if(!Array.isArray(files)||!files.length||files.length>importLimits.files)throw Error('请选择网页文件夹：最多 300 个网页文件。大型项目请先构建，再选择 dist 或 build 文件夹。');
 const seen=new Set();let total=0;
 const entries=files.map(f=>{
  if(!f||!importable(f.path)||typeof f.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))throw Error('文件格式不支持或路径不安全，请选择 HTML 网页文件夹。');
  if(seen.has(f.path.toLowerCase()))throw Error('文件路径重复，请重新选择文件夹。');seen.add(f.path.toLowerCase());
  const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
  if(bytes.length>importLimits.fileBytes||total>importLimits.totalBytes)throw Error('超过本轮容量：单文件 256 KB，总计 2 MB。请使用较小的静态页面或精简后的构建目录。');
  return {...f,bytes};
 });
 // Prefer a supplied build output over a framework's uncompiled root index.
 const candidates=['dist/index.html','build/index.html','index.html'];
 const entry=candidates.map(p=>entries.find(f=>f.path===p)).find(Boolean);
 if(!entry)throw Error('没有找到 index.html。React / Vue 请先按项目说明构建，再选择包含 index.html 的 dist 或 build 文件夹。后端项目请使用“接入已启动页面”。');
 if(/<script\b[^>]*src=["'][^"']*\.(?:tsx?|jsx)(?:[?"'])/i.test(entry.bytes.toString('utf8')))throw Error('这是尚未构建的前端源码。请先按项目说明构建，再选择 dist 或 build 文件夹；这里不会执行安装或启动脚本。');
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 if((await fs.readdir(directory)).length>=50)throw Error('已保留 50 份本地快照。请先归档或清理 state 中的 imports，再导入。');
 const root=await fs.mkdtemp(path.join(directory,'snapshot-'));
 try{
  const prefix=path.posix.dirname(entry.path)==='.'?'':path.posix.dirname(entry.path)+'/';
  const selected=entries.filter(f=>f.path.startsWith(prefix));
  for(const f of selected){const target=path.join(root,f.path.slice(prefix.length));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,f.bytes,{mode:0o600,flag:'wx'});}
  const site=await startStaticProject(root);
  return {...site,files:selected.length,bytes:selected.reduce((n,f)=>n+f.bytes.length,0),fingerprint:crypto.createHash('sha256').update(JSON.stringify(selected.map(f=>[f.path,crypto.createHash('sha256').update(f.bytes).digest('hex')]))).digest('hex')};
 }catch(e){await fs.rm(root,{recursive:true,force:true});throw e;}
}
