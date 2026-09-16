import {bodyHash} from '../lib/authorization.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index<0?null:args[index+1];};
const origin=value('--url')||process.env.ACCEPTANCE_ASSISTANT_URL||'http://127.0.0.1:4395';
const url=new URL('/codex-context.md',origin);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('只读取本机验收助手地址');
const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
if(!response.ok)throw Error('无法读取当前验收上下文：HTTP '+response.status+'。请先启动验收助手并建立任务。');
const text=await response.text(),expected=response.headers.get('x-context-sha256'),actual=bodyHash(text);
if(!expected||expected!==actual)throw Error('验收上下文指纹缺失或不一致，未交给 Codex');
const output=value('--out');
if(output){
 const resolved=path.resolve(output),cwd=path.resolve(process.cwd());
 if(resolved!==cwd&&!resolved.startsWith(cwd+path.sep))throw Error('输出文件必须位于当前项目目录内');
 await fs.mkdir(path.dirname(resolved),{recursive:true});const temporary=resolved+'.next';await fs.writeFile(temporary,text,{mode:0o600});await fs.rename(temporary,resolved);
 console.log(JSON.stringify({file:path.relative(cwd,resolved),sha256:actual,bytes:Buffer.byteLength(text)}));
}else process.stdout.write(text);

