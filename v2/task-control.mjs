import {createAuthorizationGuard} from '../lib/authorization.mjs';
import {executePlan} from './engine.mjs';
import crypto from 'node:crypto';
import {existsSync} from 'node:fs';
import path from 'node:path';

// All execution arguments come from the local operator, never from HTTP request data.
export async function createTaskControl({authorization,storeDir,execution}){
 const guard=await createAuthorizationGuard({authorization,storeDir,baseURL:authorization.origin,project:authorization.project});
 let running,lastJob,errorMessage=null;
 function state(){
  const ledger=guard.snapshot();let interrupted=false;
  if(ledger.worker?.running){try{process.kill(ledger.worker.pid,0);}catch(error){if(error.code==='ESRCH')interrupted=true;else throw error;}}
  return {...ledger,interrupted,errorMessage,canStart:!!execution&&!ledger.worker&&!running,reportAvailable:ledger.worker?.phase==='finished'&&!!ledger.worker?.runId&&existsSync(path.join(ledger.worker.runId,'results.json')),pending:ledger.actions.filter(x=>x.state==='pending'&&!x.effects.every(e=>['input','observe'].includes(e))).map(x=>({id:x.id,actionId:x.actionId,remoteTaskId:x.remoteTaskId||null}))};
 }
 async function command(data){
  if(data.command==='start'||data.command==='resume'&&!state().worker?.running||data.command==='resume'&&state().interrupted){
   const current=state(),resuming=data.command==='resume';
   if(!execution||running||(!resuming&&!current.canStart))throw Error('本任务没有可启动的新执行；已有任务不能从头重放');
   if(resuming){
    if(!current.worker||(!current.interrupted&&!current.worker.canResume)||current.pending.length)throw Error('先核对原任务，不能重放结果未知的业务动作');
    if(current.control.status==='paused')await guard.control({command:'resume',expectedRevision:data.expectedRevision});
    else guard.assertActive();
   }
   // Set synchronously before yielding to prevent a second HTTP start from racing.
   running=true;
   const job=executePlan({...execution,...(resuming?{resumeFrom:current.worker.runId,out:execution.out+'-resume-'+crypto.randomUUID()}:{}),authorization,authorizationStore:storeDir,managed:true});
   running=job;lastJob=job;
   job.catch(()=>{errorMessage='执行未完成，请查看原任务状态及已有证据。';}).finally(()=>{running=false;});
   return {started:true};
  }
  if(data.command==='query')return {queries:await guard.queryPending()};
  return guard.control(data);
 }
 async function wait(){return lastJob;}
 return {state,command,wait};
}
