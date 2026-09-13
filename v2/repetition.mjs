// A later failure extends the run once, from the first observed failure.
// The budget never grows again with each subsequent failure.
export async function repeatPath(run, policy, {initialRecords=[],onRecord=async()=>{}}={}) {
  const records = [...initialRecords];
  let limit = policy.normalRuns;
  let failureSeen = false;
  for(let i=0;i<records.length;i++)if(records[i].status==='issue'&&!failureSeen){failureSeen=true;limit=Math.max(limit,i+1+policy.failureExtraRetries);}
  for (let index = records.length; index < limit; index++) {
    const record = await run(index);
    records.push(record);
    await onRecord(records);
    if (record.status === 'issue' && !failureSeen) {
      failureSeen = true;
      limit = Math.max(limit, records.length + policy.failureExtraRetries);
    }
    // Unknown effects or blocked prerequisites must not trigger another submission.
    if (['unverified', 'blocked'].includes(record.status)) break;
  }
  return {records, ...summarizeRecords(records)};
}

export function summarizeRecords(records) {
  const counts = Object.fromEntries(['pass', 'issue', 'blocked', 'unverified'].map(s => [s, records.filter(r => r.status === s).length]));
  const findings = new Map();
  for (const r of records) {
    const failed=(r.checks||[]).filter(c=>c.pass===false&&!c.setup);
    const items=failed.length?failed.map(c=>({reason:c.problem||r.reason,pathId:c.pathId||r.failedAt,check:c.label}))
      :r.status==='issue'?[{reason:r.reason,pathId:r.failedAt}]:[];
    for(const item of items){
      const key=JSON.stringify([item.pathId,item.reason,item.check]);
      const f=findings.get(key)||{...item,attempts:[]};
      if(!f.attempts.includes(r.attempt))f.attempts.push(r.attempt);
      findings.set(key,f);
    }
  }
  const repeatedFindings = [...findings.values()].filter(f => f.attempts.length >= 2);
  const status = counts.issue ? 'issue' : counts.blocked ? 'blocked' : counts.unverified || !records.length ? 'unverified' : 'pass';
  const state = counts.issue
    ? counts.pass ? 'intermittent' : repeatedFindings.length ? 'reproduced' : 'suspected'
    : status === 'pass' ? 'verified' : 'incomplete';
  const labels = {intermittent: '异常与正常结果并存', reproduced: '同一问题重复复现', suspected: '已观察异常，尚未重复确认', verified: '重复核对符合预期', incomplete: '未完成验证'};
  return {
    status,
    findings:[...findings.values()],
    reason: records.find(r => r.status !== 'pass')?.reason || labels[state],
    evidence: {state, label: labels[state], counts, repeatedFindings, interrupted: !!(counts.unverified || counts.blocked)},
  };
}
