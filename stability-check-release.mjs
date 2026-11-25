import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {R2Transport} from './app/cloud-state/r2-transport.mjs';
import {ObjectSnapshotStore} from './app/cloud-state/object-store.mjs';
import {readVersion,rebindRelease,hash} from './app/configuration/versions.mjs';
import {publishProjection} from './app/console-projection.mjs';
const env=process.env,plan=JSON.parse(await fs.readFile('stability-plan.json'));
if(plan.mode!=='projection-check-fix'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||createHash('sha256').update(await fs.readFile('hourly-package.zip')).digest('hex')!==plan.after)throw Error('release_context');
const get=async path=>{const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'stability-release'}});if(!r.ok)throw Error('github_'+r.status);return r.json();};
if((await get('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('publisher_not_paused');
for(const run of (await get('/actions/workflows/hourly-push.yml/runs?per_page=5')).workflow_runs.filter(r=>r.status!=='completed')){const job=(await get('/actions/runs/'+run.id+'/jobs')).jobs.find(j=>j.name==='hourly');if(!job||job.status!=='completed')throw Error('publisher_active');}
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:1500,maxUploadBytes:250*1024*1024});
try{
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true,reuseBlobs:true,maxBlobCacheBytes:32*1024*1024}),before=await store.read(),op=before.data.metadata.hourly;
 if(op.publisherReleaseHash!==plan.before)throw Error('baseline_changed');
 if(op.lease){const job=(await get('/actions/runs/'+op.lease.runId+'/jobs')).jobs.find(j=>j.name==='hourly');if(!job||job.status!=='completed')throw Error('lease_active');}
 const c={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,v)=>t.putConfig(k,b,v)},current=await readVersion(c,{expectedReleaseHash:plan.before});
 await rebindRelease(c,{expectedOldRelease:plan.before,newRelease:plan.after,expectedHeadHash:current.head.hash});
 const checked=await readVersion(c,{expectedReleaseHash:plan.after});if(hash(checked.version.documents)!==hash(current.version.documents))throw Error('documents_changed');
 await store.transact(data=>{if(hash(data)!==hash(before.data))throw Error('state_changed');data.metadata.hourly.publisherReleaseHash=plan.after;data.metadata.hourly.lease=null;},{expectedRevision:before.revision});
 const previous=await t.getProjection('console-projection-v1/body.json',4*1024*1024),ai=previous&&JSON.parse(previous.bytes).capabilities?.ai;
 const projection=await publishProjection({store,transport:t,env:{...env,RELAYROUTER_API_KEY:ai?'available':undefined}});
 const receipt={status:'confirmed',mode:plan.mode,release:plan.after,configurationRevision:checked.version.revision,documentsUnchanged:true,projection,sourceCalls:0,modelCalls:0,newMessages:0};
 await fs.writeFile('stability-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{t.close();}
