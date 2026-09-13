import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
export async function playwrightRuntime() {
  try { return require('playwright'); } catch {}
  const root = path.join(os.homedir(), '.npm/_npx');
  for (const folder of await readdir(root).catch(()=>[])) {
    try { const p=path.join(root,folder,'node_modules/playwright'); if(require(p+'/package.json').version==='1.62.1') return require(p); } catch {}
  }
  throw new Error('缺少 Playwright 1.62.1，请在本目录安装依赖后运行。');
}
export async function browserEngine(){return (await playwrightRuntime()).chromium;}
