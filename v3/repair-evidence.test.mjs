import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bodyHash} from '../lib/authorization.mjs';
import {captureRepairSource,sealRepairEvidence,loadRepairEvidence,repairHTML} from './repair-evidence.mjs';
test('saved source and every record must match the server-held seal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repair-proof-'));
 try{
  const source=path.join(dir,'source'),taskDir=path.join(dir,'task'),run=path.join(taskDir,'run');await fs.mkdir(source);await fs.mkdir(run,{recursive:true});
  await fs.writeFile(path.join(source,'index.html'),'<h1>sample</h1>');
  const session={task:{id:'sample'},intake:{root:source,files:[{file:'index.html',sha256:bodyHash('<h1>sample</h1>')}]},observation:{url:'http://127.0.0.1:1/'},executionPlan:{paths:[{id:'entry'}]}};
  session.repairSource=await captureRepairSource(session,taskDir);
  await fs.writeFile(path.join(run,'results.json'),JSON.stringify({groups:[{path:{id:'entry'},status:'pass',records:[{id:'entry-0',status:'pass',checks:[{status:'pass'}],outputs:['output.json'],snapshots:[]}]}]}));
  for(const file of ['plan.json','execution-identity.json','entry-0.json','output.json'])await fs.writeFile(path.join(run,file),'{}');
  const hash=await sealRepairEvidence(session,taskDir,run);assert.equal((await loadRepairEvidence(taskDir,hash)).evidenceVerified,true);
  await assert.rejects(loadRepairEvidence(taskDir,{evidenceVerified:true}));
  await fs.writeFile(path.join(run,'output.json'),'[]');await assert.rejects(loadRepairEvidence(taskDir,hash),/产物/);
  await fs.writeFile(path.join(run,'output.json'),'{}');await fs.unlink(path.join(run,'entry-0.json'));await assert.rejects(loadRepairEvidence(taskDir,hash));
  await assert.rejects(sealRepairEvidence(session,taskDir,run));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('repair presentation escapes values and exposes source and criteria identities',()=>{
 const html=repairHTML({reason:'<script>bad</script>',beforeProgramHash:'source-before',afterProgramHash:'source-after',beforeCriteriaHash:'criteria-before',afterCriteriaHash:'criteria-after',changedFiles:['index.html']});
 assert.ok(!html.includes('<script>'));assert.match(html,/source-before/);assert.match(html,/criteria-after/);assert.match(html,/人工省时：未测得/);
});
test('resumed evidence uses its own immutable directory and seal without replacing prior evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repair-resume-proof-'));
 try{
  const source=path.join(dir,'source'),taskDir=path.join(dir,'task'),run=path.join(taskDir,'run');await fs.mkdir(source);await fs.mkdir(run,{recursive:true});
  await fs.writeFile(path.join(source,'index.html'),'sample');
  const session={task:{id:'sample'},intake:{root:source,files:[{file:'index.html',sha256:bodyHash('sample')}]},observation:{url:'http://127.0.0.1:1/'},executionPlan:{paths:[{id:'entry'}]}};
  session.repairSource=await captureRepairSource(session,taskDir);
  await fs.writeFile(path.join(run,'results.json'),JSON.stringify({groups:[{path:{id:'entry'},status:'unverified',records:[]}]}));
  for(const file of ['plan.json','execution-identity.json'])await fs.writeFile(path.join(run,file),'{}');
  const first=await sealRepairEvidence(session,taskDir,run),original=await fs.readFile(path.join(taskDir,'repair-evidence.json'));
  const name='run-resume-00000000-0000-0000-0000-000000000001',resumed=path.join(taskDir,name);await fs.cp(run,resumed,{recursive:true});
  await fs.mkdir(path.join(resumed,'previous'));await fs.writeFile(path.join(resumed,'previous/entry-0.json'),'{}');
  await fs.writeFile(path.join(resumed,'results.json'),JSON.stringify({groups:[{path:{id:'entry'},status:'pass',records:[{id:'previous/entry-0',status:'pass',checks:[]}]}]}));
  const second=await sealRepairEvidence(session,taskDir,resumed),file='repair-evidence-'+name+'.json';
  assert.equal((await loadRepairEvidence(taskDir,second,file)).groups[0].status,'pass');
  assert.equal((await loadRepairEvidence(taskDir,first)).groups[0].status,'unverified');assert.deepEqual(await fs.readFile(path.join(taskDir,'repair-evidence.json')),original);
  await assert.rejects(sealRepairEvidence(session,taskDir,resumed),/EEXIST/);await assert.rejects(loadRepairEvidence(taskDir,second));
  await assert.rejects(loadRepairEvidence(taskDir,second,'../'+file));
  await fs.writeFile(path.join(resumed,'previous/entry-0.json'),'[]');await assert.rejects(loadRepairEvidence(taskDir,second,file),/产物/);
  const forged={...JSON.parse(original),runDirectory:'../source'},text=JSON.stringify(forged);await fs.writeFile(path.join(taskDir,'repair-evidence.json'),text);await assert.rejects(loadRepairEvidence(taskDir,bodyHash(text)),/目录/);
  delete forged.runDirectory;const legacy=JSON.stringify(forged);await fs.writeFile(path.join(taskDir,'repair-evidence.json'),legacy);assert.equal((await loadRepairEvidence(taskDir,bodyHash(legacy))).evidenceVerified,true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
