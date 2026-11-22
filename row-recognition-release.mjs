// Approved hybrid collector release. No source collection, AI calls or message writes.
import fs from'node:fs/promises';import{createHash}from'node:crypto';
import{R2Transport}from'./app/cloud-state/r2-transport.mjs';import{ObjectSnapshotStore}from'./app/cloud-state/object-store.mjs';import{digest}from'./app/cloud-state/storage.mjs';import{readVersion,rebindRelease,prepareVersion,publishVersion}from'./app/configuration/versions.mjs';import{publishProjection}from'./app/console-projection.mjs';import{GetObjectCommand,PutObjectCommand}from'@aws-sdk/client-s3';
const env=process.env,old='f9a9d987650057eeded88afd44dc753b9359fc14edb9c9266c2c673e2d072e55',next='b7aba42133a66df8d3267f0abecbc568cd7845bc5a40804b895f6913f2cc84f0';
if(!['release','rollback'].includes(env.RELEASE_OPERATION))throw Error('operation_required');
const base=env.RELEASE_OPERATION==='release'?old:next,wanted=env.RELEASE_OPERATION==='release'?next:old;
const sha=b=>createHash('sha256').update(b).digest('hex');
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||env.APPROVED_PACKAGE_SHA!==wanted||sha(await fs.readFile('hourly-package.zip'))!==wanted||!/^[a-f0-9]{64}$/.test(env.APPROVED_NOTE_SHA??''))throw Error('approved_migration_context_required');
async function github(path){const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'approved-hybrid-release'},redirect:'error'});if(!r.ok)throw Error('github_'+r.status);return r.json();}
if((await github('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('hourly_not_disabled');
if((await github('/actions/workflows/hourly-push.yml/runs?per_page=10')).workflow_runs.some(r=>r.status!=='completed'))throw Error('hourly_not_quiescent');
const independentFbRuns=[];
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

 const alias={op:'alias',name:'蘭鐸 巡夢·雲海之主',alias:'蘭鐸雲海'};
 const target=version.version.documents.library.entries.find(e=>e.id==='intake-107a1fba68fcca2d684cc7a2'&&e.name===alias.name&&e.enabled);
 if(!target)throw Error('alias_target_missing');
 const proposal={baseHash:version.version.documentHash,scope:'resources',operations:[alias]};
 if(env.RELEASE_OPERATION==='release'&&!target.aliases.includes(alias.alias)) prepareVersion(version.version,proposal);
 const expected=structuredClone(before.data);expected.metadata.hourly.publisherReleaseHash=wanted;expected.metadata.hourly.lease=null;
 const uncertainBefore=digest(Object.fromEntries(Object.entries(op.outbox).filter(([,o])=>['started','unknown'].includes(o.status))));
 await store.transact(data=>{if(digest(data)!==digest(before.data))throw Error('state_changed');data.metadata.hourly.publisherReleaseHash=wanted;data.metadata.hourly.lease=null;},{expectedRevision:before.revision});
 const rereader=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true}),after=await rereader.read();if(digest(after.data)!==digest(expected))throw Error('migration_readback_failed');
 if(digest(Object.fromEntries(Object.entries(after.data.metadata.hourly.outbox).filter(([,o])=>['started','unknown'].includes(o.status))))!==uncertainBefore)throw Error('uncertain_delivery_changed');
 if(version.version.releaseHash===base)await rebindRelease(config,{expectedOldRelease:base,newRelease:wanted,expectedHeadHash:version.head.hash});

 const rebound=await readVersion(config,{expectedReleaseHash:wanted});
 if(rebound.version.documentHash!==version.version.documentHash)throw Error('business_documents_changed');
 let intended=rebound.version;
 if(env.RELEASE_OPERATION==='release'&&!target.aliases.includes(alias.alias)){
   intended=prepareVersion(rebound.version,proposal);
   await publishVersion(config,intended,{current:rebound});
 }
 const checked=await readVersion(config,{expectedReleaseHash:wanted});
 if(checked.version.documentHash!==intended.documentHash)throw Error('alias_readback_mismatch');
 for(const [key,original]of protectedObjects)if(!(await raw(key)).bytes.equals(original.bytes))throw Error('protected_object_changed');
 const priorProjection=await t.getProjection('console-projection-v1/body.json',2*1024*1024),aiAvailable=priorProjection&&JSON.parse(priorProjection.bytes).capabilities?.ai===true;
 const projection=await publishProjection({store:rereader,transport:t,env:{...env,RELAYROUTER_API_KEY:aiAvailable?'available':undefined}});
 console.log(JSON.stringify({status:'row_recognition_release_verified',beforeRevision:before.revision,afterRevision:after.revision,records:Object.keys(op.records).length,capacity:rereader.capacity,documentHash:checked.version.documentHash,configurationRevision:checked.head.revision,protectedObjectsPreserved:true,concurrentIndependentFbRuns:independentFbRuns,facebookStateWriteByMigration:false,uncertainDeliveryHash:uncertainBefore,leaseClearedOnlyAfterOwnerCompleted:!!op.lease,projection,releaseHash:wanted,noteSha:env.APPROVED_NOTE_SHA}));
}finally{t.close();}







