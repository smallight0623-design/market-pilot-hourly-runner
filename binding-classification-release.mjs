// Explicit release/resume operations. No AI, delivery, historical replay, or source time changes.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {R2Transport} from './app/cloud-state/r2-transport.mjs';
import {ObjectSnapshotStore} from './app/cloud-state/object-store.mjs';
import {readVersion,rebindRelease} from './app/configuration/versions.mjs';
import {publishProjection} from './app/console-projection.mjs';
import {validateControl,controlKey} from './app/monitor-control.mjs';
import {GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
const env=process.env,mode=env.RELEASE_OPERATION;
const base='18a62d7ddaa00fb9ce3b1199c8d8c3bd3b8936d5ba77a5ce58ebbbb09a71baea';
const wanted='06f6016f6739508ebd80f0f378ea3365161da82362fbfc30d1b1c1c54e159a2a';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(canonical(x))).digest('hex');
if(mode!=='release'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||env.APPROVED_PACKAGE_SHA!==wanted||hash(await fs.readFile('hourly-package.zip'))!==wanted)throw Error('explicit_release_context_required');
async function github(path){const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'approved-recognition-release'},redirect:'error'});if(!r.ok)throw Error('github_read_'+r.status);return r.json();}
if((await github('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('hourly_workflow_not_paused');
if((await github('/actions/workflows/hourly-push.yml/runs?per_page=10')).workflow_runs.some(r=>r.status!=='completed'))throw Error('active_hourly_work');
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:130,maxUploadBytes:30*1024*1024});
const rawKey=key=>({Bucket:t.config.bucket,Key:t.config.prefix+'/'+key});
async function raw(key,max=10*1024*1024){const o=await t.client.send(new GetObjectCommand(rawKey(key)));if(o.ContentLength>max)throw Error('read_size');const bytes=Buffer.from(await o.Body.transformToByteArray());if(bytes.length>max)throw Error('read_size');return {bytes,etag:o.ETag};}
try{
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true}),config={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,c)=>t.putConfig(k,b,c)};
 const before=await store.read(),op=before.data.metadata.hourly;
 const control=await raw(controlKey,8192),controlValue=validateControl(JSON.parse(control.bytes));
 if(controlValue.paused||Object.values(controlValue.projects).some(Boolean)||op.lease||Object.values(op.outbox??{}).some(o=>['started','unknown'].includes(o.status)))throw Error('unsafe_live_state');
 const fbSettings=hash((await raw('console-facebook-config-v1/current.json')).bytes),fbState=hash((await raw('facebook-feed-v1/state.json')).bytes);
 const receipt={at:new Date().toISOString(),mode,base,wanted,beforeRevision:before.revision,fbSettings,fbState,noteSha256:env.APPROVED_NOTE_SHA};
 const expected=structuredClone(before.data),e=expected.metadata.hourly;
 let version;
 if(mode==='release'){
  if(op.publisherReleaseHash!==base||!op.enabled)throw Error('release_baseline_changed');
  version=await readVersion(config,{expectedReleaseHash:base});
  e.enabled=false;e.publisherReleaseHash=wanted;
 }else{
  if(op.publisherReleaseHash!==wanted||op.enabled||op.recognitionResume)throw Error('resume_baseline_changed');
  version=await readVersion(config,{expectedReleaseHash:wanted});
  const {chromium}=await import('./app/cloud-trial/node_modules/playwright/index.mjs');
  const {readPublicPage}=await import('./app/cloud-trial/stage1.mjs');
  const {sources}=await import('./app/market-sources.mjs');
  const browser=await chromium.launch({headless:true}),baselines=[];
  try{
   const context=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei',viewport:{width:1280,height:900}}),page=await context.newPage();
   for(const source of sources){
    const c=await readPublicPage(page,source.url,'list',async()=>{},()=>new Date().toISOString(),{maxListScrolls:4,retryTransientList:false});
    if(c.status!=='readable'||c.httpStatus!==200||c.actualUrl!==source.url||!c.listings.length||c.pagination?.currentPage!==1)throw Error('resume_source_baseline_unavailable');
    const ids=[...new Set(c.listings.map(x=>x.id))];if(ids.some(id=>!/^\d+$/.test(id)))throw Error('baseline_id_invalid');
    const evidence=await store.putBlob(Buffer.from(JSON.stringify(c)));
    baselines.push({sourceId:source.id,sourceUrl:source.url,knownIds:ids,observedAt:c.observedAt,evidenceHash:evidence.hash});
   }
  }finally{await browser.close();}
  const now=new Date().toISOString(),held=[];
  for(const c of Object.values(e.candidates??{}))if(['pending','ready','awaiting_route'].includes(c.status)){
   held.push({id:c.id,previousStatus:c.status});c.resumeHold={previousStatus:c.status,at:now,reason:'no_historical_replay_per_user'};c.status='held_at_resume';
  }
  for(const b of baselines){
   e.headScans??={};e.headScans[b.sourceId]={version:1,sourceUrl:b.sourceUrl,knownIds:b.knownIds,gapNextPage:null,observedAt:b.observedAt,overlapConfirmed:true,reason:'explicit_resume_baseline_no_backfill'};
   for(const id of b.knownIds)if(!e.candidates[id]&&!e.records[id])e.candidates[id]={id,sourceUrl:'https://www.8591.com.tw/v3/mall/detail/'+id,sourceId:b.sourceId,firstSeenAt:b.observedAt,status:'known_at_resume',resumeBaseline:true};
  }
  const audit=await store.putBlob(Buffer.from(JSON.stringify({at:now,baselines,held,policy:'original_time_reader_and_hourly_schedule_unchanged_no_historical_replay'})));
  e.recognitionResume={at:now,releaseHash:wanted,auditHash:audit.hash,heldCount:held.length,baselineCount:baselines.reduce((n,b)=>n+b.knownIds.length,0)};e.enabled=true;
  receipt.resume=e.recognitionResume;
 }
 const originalHash=hash(before.data);
 await store.transact(data=>{if(hash(data)!==originalHash)throw Error('live_state_changed');data.metadata.hourly=structuredClone(e);},{expectedRevision:before.revision});
 let after=await store.read();if(hash(after.data)!==hash(expected))throw Error('state_readback_failed');
 if(mode==='release')await rebindRelease(config,{expectedOldRelease:base,newRelease:wanted,expectedHeadHash:version.head.hash});
 const checked=await readVersion(config,{expectedReleaseHash:wanted});if(checked.version.documentHash!==version.version.documentHash)throw Error('business_documents_changed');
 e.enabled=true;await store.transact(data=>{if(hash(data)!==hash(after.data))throw Error('staged_state_changed');data.metadata.hourly.enabled=true;},{expectedRevision:after.revision});after=await store.read();if(hash(after.data)!==hash(expected))throw Error('enable_readback_failed');
 const oldProjection=await t.getProjection('console-projection-v1/body.json',2*1024*1024),aiAvailable=oldProjection&&JSON.parse(oldProjection.bytes).capabilities?.ai===true;
 const projection=await publishProjection({store:{read:async()=>after},transport:t,env:{RELAYROUTER_API_KEY:aiAvailable?'available':undefined}});if(projection.status!=='confirmed')throw Error('projection_unconfirmed');
 if(hash((await raw('console-facebook-config-v1/current.json')).bytes)!==fbSettings||hash((await raw('facebook-feed-v1/state.json')).bytes)!==fbState)throw Error('facebook_state_changed');
 if(mode==='resume'){
  const next=validateControl({...controlValue,revision:controlValue.revision+1,paused:false,projects:{'aov-8591':false,'facebook-feed':false},updatedAt:new Date().toISOString()});
  await t.client.send(new PutObjectCommand({...rawKey(controlKey),Body:Buffer.from(JSON.stringify(next)),ContentType:'application/json',IfMatch:control.etag}));
  if(hash(JSON.parse((await raw(controlKey,8192)).bytes))!==hash(next))throw Error('control_readback_failed');
  receipt.controlRevision=next.revision;
 }else if(hash((await raw(controlKey,8192)).bytes)!==hash(control.bytes))throw Error('control_changed');
 after=await store.read();if(hash(after.data)!==hash(expected))throw Error('final_state_changed');
 Object.assign(receipt,{afterRevision:after.revision,configRevision:checked.version.revision,documentHash:checked.version.documentHash,businessRecordsPreserved:hash(op.records)===hash(after.data.metadata.hourly.records),facebookPreserved:true,projection:projection.status});
 const blob=await store.putBlob(Buffer.from(JSON.stringify(receipt)));console.log(JSON.stringify({event:'approved_recognition_'+mode,...receipt,receiptSha256:blob.hash}));
}finally{t.close();}
