import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {R2Transport} from './app/cloud-state/r2-transport.mjs';
import {ObjectSnapshotStore} from './app/cloud-state/object-store.mjs';
import {readVersion,rebindRelease,hash} from './app/configuration/versions.mjs';
import {publishProjection} from './app/console-projection.mjs';
const env=process.env,plan=JSON.parse(await fs.readFile('stability-plan.json'));
if(!['projection-check-fix','processing-goal-fix'].includes(plan.mode)||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||createHash('sha256').update(await fs.readFile('hourly-package.zip')).digest('hex')!==plan.after)throw Error('release_context');
const get=async path=>{const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'stability-release'}});if(!r.ok)throw Error('github_'+r.status);return r.json();};
if((await get('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('publisher_not_paused');
if((await get('/actions/workflows/hourly-push.yml/runs?per_page=5')).workflow_runs.some(r=>r.status!=='completed'))throw Error('publisher_pipeline_active');
 for(const run of (await get('/actions/workflows/hourly-push.yml/runs?per_page=5')).workflow_runs.filter(r=>r.status!=='completed')){const jobs=(await get('/actions/runs/'+run.id+'/jobs')).jobs.filter(j=>['hourly','Facebook independent collection and publishing'].includes(j.name));if(jobs.length<2||jobs.some(j=>j.status!=='completed'))throw Error('publisher_active');}
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:1500,maxUploadBytes:250*1024*1024});
try{
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true,reuseBlobs:true,maxBlobCacheBytes:32*1024*1024}),before=await store.read(),op=before.data.metadata.hourly;
 if(op.publisherReleaseHash!==plan.before)throw Error('baseline_changed');
 if(op.lease){const job=(await get('/actions/runs/'+op.lease.runId+'/jobs')).jobs.find(j=>j.name==='hourly');if(!job||job.status!=='completed')throw Error('lease_active');}
 const c={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,v)=>t.putConfig(k,b,v)},current=await readVersion(c,{expectedReleaseHash:plan.before});
 const savedDetails=[];
 const normalised={sourceReview:[],expiredPrepared:[],incompleteDetails:[]},readinessChanges=[];
 if(plan.reclassifyDetailIds?.length){
  const {detailReadinessFailure}=await import('./app/scrappey/provider.mjs'),{retryableDetailReply,recentRequests}=await import('./app/scrappey/retry-policy.mjs');
  for(const id of plan.reclassifyDetailIds){
   if(id!=='2420940736')throw Error('readiness_recovery_scope');if(op.records[id]?.messageId)continue;
   if(op.candidates[id]?.status!=='pending')throw Error('readiness_candidate_changed');
   const requests=recentRequests(op,id,Date.now());if(requests.some(r=>['started','unknown','blocked'].includes(r.status)))throw Error('readiness_request_held');
   const request=requests.filter(r=>r.status==='received').at(-1);if(!request)throw Error('readiness_evidence_missing');
   const key=Object.keys(op.scrappeyRequests).find(k=>op.scrappeyRequests[k]===request),bytes=await store.getBlob(request.evidenceHash);if(createHash('sha256').update(bytes).digest('hex')!==request.evidenceHash)throw Error('readiness_checksum');
   const raw=JSON.parse(bytes);if(raw.id!==id||raw.observedAt!==request.at||raw.reply?.outcome!=='received')throw Error('readiness_identity');
   const incomplete=detailReadinessFailure(raw.reply.response,{url:op.candidates[id].sourceUrl});if(!incomplete||!retryableDetailReply(incomplete))throw Error('readiness_classification_changed');
   readinessChanges.push({key,patch:{status:'invalid',originalStatus:'received',reason:incomplete.reason,retryable:true,originStatus:200,reclassifiedAt:new Date().toISOString(),readinessRevision:'detail-readiness-v1'}});normalised.incompleteDetails.push(id);
  }
 }
 if(plan.mode==='processing-goal-fix'){
  const {savedDetailEligible}=await import('./app/scrappey/live-reader.mjs');
  for(const id of plan.savedDetailIds??[]){
   if(!['2420926465','2420926682'].includes(id))throw Error('recovery_scope');
   if(op.records[id]?.messageId)continue;const candidate=op.candidates[id];if(!candidate||!['pending','outside_window_or_date_unknown'].includes(candidate.status))throw Error('recovery_status');
   const copy={...op,candidates:{...op.candidates,[id]:{...candidate,status:'pending'}}};
   if(!savedDetailEligible(copy,candidate,Date.now()))throw Error('recovery_not_admitted');
   const request=Object.values(op.scrappeyRequests).filter(r=>r.id===id&&r.status==='received').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
   const bytes=await store.getBlob(request.evidenceHash);if(createHash('sha256').update(bytes).digest('hex')!==request.evidenceHash)throw Error('recovery_checksum');
   const raw=JSON.parse(bytes);if(raw.id!==id||raw.observedAt!==request.at||raw.reply?.outcome!=='received'||raw.reply.response?.solution?.statusCode!==200||raw.reply.response.solution.currentUrl!==candidate.sourceUrl)throw Error('recovery_identity');savedDetails.push(id);
  }
 }
 if(plan.normalizeReviews===true){
  const {inNewListingWindow}=await import('./app/hourly/policy.mjs'),now=Date.now();
  for(const r of Object.values(op.scrappeyRequests??{}))if(['started','unknown'].includes(r.status)&&now-Date.parse(r.at)>=0&&now-Date.parse(r.at)<86400000&&!op.records[r.id]?.messageId&&['pending','outside_window_or_date_unknown'].includes(op.candidates[r.id]?.status)&&!normalised.sourceReview.includes(r.id))normalised.sourceReview.push(r.id);
  for(const c of Object.values(op.candidates))if(c.status==='ready'&&c.prepared&&!op.records[c.id]?.messageId&&!inNewListingWindow(c.prepared.publishedAt,now)&&!Object.values(op.outbox).some(o=>o.id===c.id&&['started','unknown'].includes(o.status)))normalised.expiredPrepared.push(c.id);
 }
 await rebindRelease(c,{expectedOldRelease:plan.before,newRelease:plan.after,expectedHeadHash:current.head.hash});
 const checked=await readVersion(c,{expectedReleaseHash:plan.after});if(hash(checked.version.documents)!==hash(current.version.documents))throw Error('documents_changed');
 await store.transact(data=>{if(hash(data)!==hash(before.data))throw Error('state_changed');const live=data.metadata.hourly;live.publisherReleaseHash=plan.after;live.lease=null;for(const {key,patch} of readinessChanges)Object.assign(live.scrappeyRequests[key],patch);for(const id of savedDetails)live.candidates[id].status='pending';for(const id of normalised.sourceReview){const r=Object.values(live.scrappeyRequests).filter(r=>r.id===id&&['started','unknown'].includes(r.status)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];live.candidates[id].status='detail_requires_review';live.candidates[id].detailReview={diagnosticCode:r.reason??'uncertain_prior_request',at:r.at,runId:r.runId,responseEvidenceHash:r.evidenceHash??null};}for(const id of normalised.expiredPrepared){live.candidates[id].status='outside_window_or_date_unknown';live.candidates[id].archiveReason='prepared_listing_expired';}},{expectedRevision:before.revision});
 const previous=await t.getProjection('console-projection-v1/body.json',4*1024*1024),ai=previous&&JSON.parse(previous.bytes).capabilities?.ai;
 const projection=await publishProjection({store,transport:t,env:{...env,RELAYROUTER_API_KEY:ai?'available':undefined}});
 const receipt={status:'confirmed',mode:plan.mode,release:plan.after,configurationRevision:checked.version.revision,documentsUnchanged:true,savedDetails,normalised,projection,sourceCalls:0,modelCalls:0,newMessages:0};
 await fs.writeFile('stability-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{t.close();}
