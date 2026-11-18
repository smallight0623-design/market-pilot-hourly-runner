import fs from'node:fs/promises';import{createHash}from'node:crypto';
import{createProvider}from'./app/scrappey/provider.mjs';import{decodeResponse}from'./app/scrappey/decode.mjs';import{R2Transport}from'./app/cloud-state/r2-transport.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),env=process.env;
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||sha(await fs.readFile('hourly-package.zip'))!==env.APPROVED_PACKAGE_SHA)throw Error('canary_context');
const url='https://www.8591.com.tw/v3/mall/detail/2420831235',observedAt=new Date().toISOString(),reply=await createProvider({apiKey:env.SCRAPPEY_API_KEY})(url);
const bytes=Buffer.from(JSON.stringify({at:observedAt,runId:env.GITHUB_RUN_ID,mode:'isolated_scrappey_transport_canary',reply})),hash=sha(bytes),t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:8,maxUploadBytes:2*1024*1024});
try{await t.putIf('blobs/'+hash+'.blob',bytes,{absent:true});if(sha((await t.get('blobs/'+hash+'.blob',2*1024*1024)).bytes)!==hash)throw Error('evidence_readback');
if(reply.outcome!=='received'){console.log(JSON.stringify({status:'rejected',outcome:reply.outcome,reason:reply.reason,diagnostic:reply.diagnostic,evidenceHash:hash}));process.exitCode=2;}
else{const c=await decodeResponse(reply.response,{url,kind:'detail',observedAt});console.log(JSON.stringify({status:'transport_verified',originStatus:c.scrappeyEvidence.originStatus,mainImages:c.images.length,collectionMethod:c.collectionMethod,evidenceHash:hash,productionStateChanged:false,aiCalls:0,discordWrites:0}));}}finally{t.close();}

