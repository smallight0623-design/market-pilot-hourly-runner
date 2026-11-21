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
    const state=JSON.parse(await existing.Body.transformToString());
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
    console.log(JSON.stringify({status:inspectOnly && status==='released_terminal_run'?'eligible_for_recovery':status,inspectOnly,stateBytes:existing.ContentLength,limitBytes:limit}));
  }
} finally { sdk.destroy(); }

