// Approved hybrid collector release. No source collection, AI calls or message writes.
import fs from'node:fs/promises';import{createHash}from'node:crypto';
import{R2Transport}from'./app/cloud-state/r2-transport.mjs';import{ObjectSnapshotStore}from'./app/cloud-state/object-store.mjs';import{digest}from'./app/cloud-state/storage.mjs';import{readVersion,rebindRelease}from'./app/configuration/versions.mjs';import{publishProjection}from'./app/console-projection.mjs';import{GetObjectCommand,PutObjectCommand}from'@aws-sdk/client-s3';
const env=process.env,old='51fd3c610511403d1bc85c43634f885490bf04917ebe1ee3dfd9e2a0e353bb91',next='e6f99225015b2432b7056d9ddd13454c4965dd1333ff3602c79b40f4868389c5';
if(!['release','rollback'].includes(env.RELEASE_OPERATION))throw Error('operation_required');
const base=env.RELEASE_OPERATION==='release'?old:next,wanted=env.RELEASE_OPERATION==='release'?next:old;
const sha=b=>createHash('sha256').update(b).digest('hex');
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||env.APPROVED_PACKAGE_SHA!==wanted||sha(await fs.readFile('hourly-package.zip'))!==wanted||!/^[a-f0-9]{64}$/.test(env.APPROVED_NOTE_SHA??''))throw Error('approved_migration_context_required');
async function github(path){const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'approved-hybrid-release'},redirect:'error'});if(!r.ok)throw Error('github_'+r.status);return r.json();}
if((await github('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('hourly_not_disabled');
const independentFbRuns=[];
for(const run of (await github('/actions/workflows/hourly-push.yml/runs?per_page=10')).workflow_runs.filter(r=>r.status!=='completed')){
 const jobs=(await github('/actions/runs/'+run.id+'/jobs')).jobs;
 if(!jobs.length||jobs.some(j=>j.status!=='completed'&&j.name!=='Facebook independent collection and publishing')||!jobs.some(j=>j.name==='hourly'&&j.status==='completed')||!jobs.some(j=>j.name==='daily_cp / ranking'&&j.status==='completed'))throw Error('shared_writer_active');
 independentFbRuns.push('fb-'+run.id);
}
// facebook/cloud-entry.mjs permits writes only to its dedicated state/favorites
// and immutable response blobs; it reads release configuration once at startup.
// This migration never writes those keys and cannot overwrite its progress.

const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:1000,maxUploadBytes:150*1024*1024});
async function raw(key,max=40*1024*1024){const o=await t.client.send(new GetObjectCommand({Bucket:t.config.bucket,Key:t.config.prefix+'/'+key}));if(o.ContentLength>max)throw Error('raw_size');const bytes=Buffer.from(await o.Body.transformToByteArray());if(bytes.length>max)throw Error('raw_size');return{bytes,etag:o.ETag};}
try{
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true}),config={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,c)=>t.putConfig(k,b,c)};
 const before=await store.read(),op=before.data.metadata.hourly;if(![base,wanted].includes(op.publisherReleaseHash)||!op.enabled)throw Error('baseline_changed');
 if(op.lease){if(!Number.isFinite(Date.parse(op.lease.expiresAt))||Date.parse(op.lease.expiresAt)>Date.now())throw Error('active_lease');const owner=await github('/actions/runs/'+op.lease.runId);if(owner.status!=='completed')throw Error('lease_owner_active');}
 const version=await readVersion(config);if(![base,wanted].includes(version.version.releaseHash))throw Error('configuration_release_changed');
 const protectedKeys=[...(independentFbRuns.length?[]:['facebook-feed-v1/state.json']),'console-facebook-config-v1/current.json','console-catalog-v1/publication.json','console-catalog-v1/drafts/'+sha('smallight-owner')+'.json'];
 const protectedObjects=new Map();for(const key of protectedKeys)protectedObjects.set(key,await raw(key));
 const pub=JSON.parse(protectedObjects.get('console-catalog-v1/publication.json').bytes);if(pub.status==='building'||pub.status==='queued')throw Error('catalog_publication_requires_separate_review');
 if(independentFbRuns.length){const fb=JSON.parse((await raw('facebook-feed-v1/state.json')).bytes);if(fb.lease&&!independentFbRuns.includes(fb.lease.runId))throw Error('unexpected_fb_owner');}
 const expected=structuredClone(before.data);expected.metadata.hourly.publisherReleaseHash=wanted;expected.metadata.hourly.lease=null;
 const uncertainBefore=digest(Object.fromEntries(Object.entries(op.outbox).filter(([,o])=>['started','unknown'].includes(o.status))));
 await store.transact(data=>{if(digest(data)!==digest(before.data))throw Error('state_changed');data.metadata.hourly.publisherReleaseHash=wanted;data.metadata.hourly.lease=null;},{expectedRevision:before.revision});
 const rereader=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true}),after=await rereader.read();if(digest(after.data)!==digest(expected))throw Error('migration_readback_failed');
 if(digest(Object.fromEntries(Object.entries(after.data.metadata.hourly.outbox).filter(([,o])=>['started','unknown'].includes(o.status))))!==uncertainBefore)throw Error('uncertain_delivery_changed');
 if(version.version.releaseHash===base)await rebindRelease(config,{expectedOldRelease:base,newRelease:wanted,expectedHeadHash:version.head.hash});
 const checked=await readVersion(config,{expectedReleaseHash:wanted});if(checked.version.documentHash!==version.version.documentHash)throw Error('business_documents_changed');
 for(const [key,original]of protectedObjects)if(!(await raw(key)).bytes.equals(original.bytes))throw Error('protected_object_changed');
 const priorProjection=await t.getProjection('console-projection-v1/body.json',2*1024*1024),aiAvailable=priorProjection&&JSON.parse(priorProjection.bytes).capabilities?.ai===true;
 const projection=await publishProjection({store:rereader,transport:t,env:{...env,RELAYROUTER_API_KEY:aiAvailable?'available':undefined}});
 console.log(JSON.stringify({status:'long_image_release_verified',beforeRevision:before.revision,afterRevision:after.revision,records:Object.keys(op.records).length,capacity:rereader.capacity,documentHash:checked.version.documentHash,configurationRevision:checked.head.revision,protectedObjectsPreserved:true,concurrentIndependentFbRuns:independentFbRuns,facebookStateWriteByMigration:false,uncertainDeliveryHash:uncertainBefore,leaseClearedOnlyAfterOwnerCompleted:!!op.lease,projection,releaseHash:wanted,noteSha:env.APPROVED_NOTE_SHA}));
}finally{t.close();}






