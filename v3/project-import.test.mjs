import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importStaticProject,importable} from './project-import.mjs';
import {connectJS} from './connect-page.mjs';
import {cloudJS} from './cloud-page.mjs';
const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
test('reject traversal, hidden/configuration files and unsupported uploads',async()=>{
 for(const p of ['../index.html','/index.html','site/./index.html','site\\index.html','.env','node_modules/a.js','secret.json','个人能力梯度.html','package.json'])assert.equal(importable(p),false,p);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intake-reject-'));
 try{
  await assert.rejects(importStaticProject([file('../index.html','oops')],root),/路径不安全/);
  await assert.rejects(importStaticProject([file('app.js','')],root),/没有找到 index.html/);
  await assert.rejects(importStaticProject([file('index.html','<script src="/src/main.tsx"></script>')],root),/尚未构建/);
  await assert.rejects(importStaticProject([file('index.html','x'.repeat(256001))],root),/容量/);
  await assert.rejects(importStaticProject([file('index.html',''),file('index.html','')],root),/重复/);
  assert.deepEqual(await fs.readdir(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('serve the selected build, retain its contract and keep immutable version snapshots',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intake-serve-'));let before,after;
 try{
  before=await importStaticProject([file('index.html','source'),file('dist/index.html','<h1>Before</h1>'),file('dist/app.js','void 0'),file('dist/acceptance.spec.json','{}')],root);
  after=await importStaticProject([file('index.html','<h1>After</h1>')],root);
  assert.equal(await(await fetch(before.url)).text(),'<h1>Before</h1>');
  assert.equal(await(await fetch(after.url)).text(),'<h1>After</h1>');
  assert.notEqual(before.fingerprint,after.fingerprint);assert.notEqual(before.root,after.root);
  assert.equal(before.hasAcceptanceContract,true);assert.equal(after.hasAcceptanceContract,false);
  assert.equal((await fetch(before.url+'.env')).status,404);
 }finally{await Promise.all([before,after].filter(Boolean).map(s=>new Promise(r=>s.server.close(r))));await fs.rm(root,{recursive:true,force:true});}
});
test('browser intake and online guide scripts parse',()=>{new Function(connectJS);new Function(cloudJS);});
