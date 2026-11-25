// Independent of the private application: never reads its state or private logs.
export const prefix='i015-trial/hourly-live-v1/execution-health-v1/';
const phases=[[/Collect and publish|Facebook collection and pending continuation/,'collection'],[/Refresh rolling-week/,'search'],[/Verify application rules|Verify Facebook rules/,'rules'],[/recognition bridge|pattern bridge|currency bridge/,'recognition'],[/bootstrap|application|dependencies|runtime|Python|Node|checkout|setup-/i,'preflight']];
export function stageFor(step){return phases.find(([pattern])=>pattern.test(step?.name??''))?.[1]??'preflight';}
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function observation(run,job,platform,now=new Date().toISOString()){
 if(!['8591','facebook'].includes(platform)||!/^\d+$/.test(String(run.id))||!validDate(run.created_at)||!validDate(now))throw Error('health_identity');
 const failed=job?.steps?.find(s=>['failure','timed_out','cancelled'].includes(s.conclusion)),current=failed??job?.steps?.find(s=>s.status==='in_progress');
 const completed=job?.status==='completed',conclusions=new Set(['success','failure','cancelled','timed_out','skipped','action_required','neutral','stale']);
 return {version:1,platform,runId:String(run.id),runStartedAt:run.run_started_at??run.created_at,observedAt:now,phase:completed?'completed':job?.status==='in_progress'?'running':'queued',stage:current?stageFor(current):completed?'finished':'preflight',stageStartedAt:validDate(current?.started_at)?current.started_at:null,finishedAt:completed&&validDate(job.completed_at)?job.completed_at:null,conclusion:completed?(conclusions.has(job.conclusion)?job.conclusion:'unknown'):null,failedStage:failed?stageFor(failed):null};
}
export function mergeHealth(previous,next){
 if(previous){
  if(previous.version!==1||previous.platform!==next.platform)throw Error('health_previous_invalid');
  if(BigInt(previous.runId)>BigInt(next.runId)||previous.runId===next.runId&&(Date.parse(previous.observedAt)>Date.parse(next.observedAt)||previous.phase==='completed'&&next.phase!=='completed'))return null;
 }
 const compact=r=>({runId:r.runId,conclusion:r.conclusion,finishedAt:r.finishedAt,failedStage:r.failedStage});
 return {...next,lastCompleted:next.phase==='completed'?compact(next):previous?.lastCompleted??(previous?.phase==='completed'?compact(previous):null)};
}
export async function saveHealth(io,key,next){
 for(let attempt=0;attempt<3;attempt++){
  const saved=await io.get(key),previous=saved?JSON.parse(saved.text):null,value=mergeHealth(previous,next);if(!value)return 'superseded';
  const text=JSON.stringify(value);if(Buffer.byteLength(text)>8192)throw Error('health_too_large');
  try{await io.put(key,text,saved?{etag:saved.etag}:{absent:true});return 'confirmed';}catch(e){if(e.name!=='PreconditionFailed'&&e.$metadata?.httpStatusCode!==412)throw e;}
 }
 throw Error('health_publish_conflict');
}
