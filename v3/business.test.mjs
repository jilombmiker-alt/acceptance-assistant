import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectProject} from '../v2/inspect.mjs';
import {compileBusinessTask} from './business.mjs';
const source=path.resolve(import.meta.dirname,'../projects/reading-list');
test('reading repair launcher configuration scopes copies and adds frozen export regressions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reading-business-'));
 try{
  for(const f of ['README.md','index.html','app.js','help.html'])await fs.copyFile(path.join(source,f),path.join(root,f));
  const intake=await inspectProject(root),args={id:'business-test',intake,observation:{url:'http://127.0.0.1:4397/index.html'}};
  await assert.rejects(compileBusinessTask(args),/只适用/);
  const task=await compileBusinessTask({...args,reviewedRoot:root,exportRegressions:true});assert.equal(task.plan.paths.length,11);
  const byId=id=>task.plan.paths.find(p=>p.id===id);assert.deepEqual(byId('export-filter').dependsOn,['filter']);assert.deepEqual(byId('export-refresh').dependsOn,['persist']);assert.equal(byId('export-unread').checks[0].expected.books[0].read,false);assert.equal(byId('export').checks[0].expected.books[0].read,true);
  const reduced=await compileBusinessTask({...args,reviewedRoot:root,exportRegressions:true,excludedPaths:['filter']});assert.ok(!reduced.plan.paths.some(p=>['filter','export-filter'].includes(p.id)));assert.equal(reduced.templateHash,task.templateHash);
  await assert.rejects(compileBusinessTask({...args,reviewedRoot:source,exportRegressions:true}),/只适用/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('default public reviewed template retains its eight fixed paths',async()=>{
 const task=await compileBusinessTask({id:'public-template-test',intake:await inspectProject(source),observation:{url:'http://127.0.0.1:4397/k2/index.html'}});assert.equal(task.plan.paths.length,8);assert.ok(!task.plan.paths.some(p=>p.id==='export-filter'));
});
