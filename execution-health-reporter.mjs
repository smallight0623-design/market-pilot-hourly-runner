import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {observation,saveHealth,prefix} from './execution-health.mjs';
const env=process.env,repo='smallight0623-design/market-pilot-hourly-runner';
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repo||!/^\d+$/.test(env.GITHUB_RUN_ID??''))throw Error('health_context');
const endpoint=new URL(env.R2_ENDPOINT);if(endpoint.protocol!=='https:'||!/^\w{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.username||endpoint.password)throw Error('health_endpoint');
const client=new S3Client({endpoint:endpoint.origin,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestHandler:{requestTimeout:15000,connectionTimeout:10000}});
const allowed=new Set(['8591.json','facebook.json','probe-8591.json'].map(k=>prefix+k)),bucket='market-pilot-state-trial';
const io={async get(key){if(!allowed.has(key))throw Error('health_key');try{const r=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));if(r.ContentLength>8192)throw Error('health_too_large');const text=await r.Body.transformToString();if(Buffer.byteLength(text)>8192)throw Error('health_too_large');return{text,etag:r.ETag};}catch(e){if(e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)return null;throw e;}},async put(key,text,c){if(!allowed.has(key))throw Error('health_key');await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:text,ContentType:'application/json',...(c.absent?{IfNoneMatch:'*'}:{IfMatch:c.etag})}));}};
const get=async path=>{const r=await fetch('https://api.github.com/repos/'+repo+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'market-health'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('github_'+r.status);return r.json();};
try{
 const own=await get('/actions/runs/'+env.GITHUB_RUN_ID);
 if(env.HEALTH_TARGET_RUN_ID&&(own.path!=='.github/workflows/execution-health-observe.yml'||!/^\d+$/.test(env.HEALTH_TARGET_RUN_ID)))throw Error('health_target');
 const run=env.HEALTH_TARGET_RUN_ID?await get('/actions/runs/'+env.HEALTH_TARGET_RUN_ID):own,probe=run.path==='.github/workflows/execution-health-probe.yml';
 if(!probe&&run.path!=='.github/workflows/hourly-push.yml')throw Error('health_workflow');
 const targets=probe?[['8591','hourly']]:[['8591','hourly'],['facebook','Facebook independent collection and publishing']];
 const done=new Set(),deadline=Date.now()+80*60000;let failures=0;
 while(Date.now()<deadline){
  try{
   const jobs=(await get('/actions/runs/'+run.id+'/jobs?per_page=100')).jobs;
   for(const [platform,name]of targets){if(done.has(platform))continue;const job=jobs.find(j=>j.name===name);const next=observation(run,job,platform);await saveHealth(io,prefix+(probe?'probe-':'')+platform+'.json',next);if(next.phase==='completed')done.add(platform);}
   failures=0;if(done.size===targets.length){console.log(JSON.stringify({event:'execution_health_finished',platforms:[...done]}));break;}
  }catch{failures++;console.log(JSON.stringify({event:'execution_health_retry',attempt:failures}));if(failures>=5)throw Error('health_unavailable');}
  await new Promise(resolve=>setTimeout(resolve,60000));
 }
 if(done.size!==targets.length)throw Error('health_watch_expired');
}finally{client.destroy();}
