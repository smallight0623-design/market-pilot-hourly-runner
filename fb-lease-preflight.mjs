import {downloadBundle} from './bootstrap.mjs';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {recoverExpiredLease} from './fb-lease-recovery.mjs';
const env = process.env;
const inspectOnly = process.argv[2] === '--inspect';
const sdk = new S3Client({endpoint:env.R2_ENDPOINT,region:'auto',forcePathStyle:true,maxAttempts:1,
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
const object = {Bucket:'market-pilot-state-trial',Key:'i015-trial/hourly-live-v1/facebook-feed-v1/state.json'};
const limit = 32*1024*1024;
try {
  let existing;
  try { existing = await sdk.send(new GetObjectCommand(object)); }
  catch (e) { if(e.name !== 'NoSuchKey') throw e; }
  if(existing){
    if(!existing.ETag || !Number.isSafeInteger(existing.ContentLength) || existing.ContentLength > limit) throw Error('fb_state_size_or_version_unknown');
    const raw=Buffer.from(await existing.Body.transformToByteArray());
    let state=JSON.parse(raw);
    const checkpoint=state?.format==='fb-delta-v1';
    if(checkpoint){
      await downloadBundle({...env,APPROVED_PACKAGE_SHA:'bf9ff02d6ed3603726dacf32674bccfe467d2eb643509ba16b8e9a660f90a35d'},{output:'fb-verified-decoder.mjs'});
      const {decodeCheckpoint}=await import('./fb-verified-decoder.mjs');
      state=await decodeCheckpoint(raw,async key=>{
        const base=await sdk.send(new GetObjectCommand({...object,Key:'i015-trial/hourly-live-v1/'+key}));
        if(!Number.isSafeInteger(base.ContentLength)||base.ContentLength>limit)throw Error('fb_base_size');
        return Buffer.from(await base.Body.transformToByteArray());
      });
    }
    if(process.argv[2]==='--materialize'){
      if(state?.version!==1||!state.jobs||!state.posts||!state.months||state.lease)throw Error('fb_state_not_idle');
      if(checkpoint){
        const bytes=Buffer.from(JSON.stringify(state));
        if(bytes.length>limit)throw Error('fb_state_size');
        await sdk.send(new PutObjectCommand({...object,Body:bytes,ContentType:'application/json',IfMatch:existing.ETag}));
      }
      console.log(JSON.stringify({status:'legacy_materialized',changed:checkpoint}));
    } else {
    if(state.version!==1 || !state.posts || !state.jobs || !state.months) throw Error('fb_state_invalid');
    const status=await recoverExpiredLease({state,now:Date.now(),currentRunId:env.GITHUB_RUN_ID,
      lookup:async id=>{
        const r=await fetch('https://api.github.com/repos/smallight0623-design/market-pilot-hourly-runner/actions/runs/'+id,{
          headers:{Authorization:'Bearer '+env.GH_TOKEN},redirect:'error',signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw Error('fb_previous_run_unverified');
        return r.json();
      },
      save:async value=>{
        const bytes=Buffer.from(JSON.stringify(value));
        if(bytes.length>limit)throw Error('fb_recovery_size_limit');
        if (!inspectOnly) await sdk.send(new PutObjectCommand({...object,Body:bytes,ContentType:'application/json',IfMatch:existing.ETag}));
      }});
    console.log(JSON.stringify({status:inspectOnly && status==='released_terminal_run'?'eligible_for_recovery':status,inspectOnly,checkpoint,stateBytes:existing.ContentLength,limitBytes:limit}));
    }
  }
} finally { sdk.destroy(); }

