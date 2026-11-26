// Explicit two-case recovery. No collection/provider/model calls and no unknown intent replay.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {decodeCheckpoint} from './app/facebook/checkpoint-entry.mjs';
import {openFacebookStore,acquireFacebookLease,releaseFacebookLease,facebookStateKey} from './app/facebook/cas-store.mjs';
import {readVersion} from './app/configuration/versions.mjs';
import {decodeReply,approvedSkinNames,approvedGameTerms} from './app/facebook/reply.mjs';
import {prepareEntry,deliverFeed} from './app/facebook/feed.mjs';
import {filterFeedResources} from './app/resource-library/selected-scope.mjs';
import {decodeRoutes,routingKey} from './app/facebook/registry.mjs';
import {discordTransport} from './app/facebook/discord-transport.mjs';
import {prepareFacebookPhoto} from './app/facebook/cloud-photo-source.mjs';
const env=process.env,apply=env.RECOVERY_MODE==='apply',runId='saved-recovery-'+env.GITHUB_RUN_ID,sha=b=>createHash('sha256').update(b).digest('hex');
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||!['preview','apply'].includes(env.RECOVERY_MODE))throw Error('recovery_context');
const endpoint=new URL(env.R2_ENDPOINT);if(endpoint.protocol!=='https:'||!/^\w{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.username||endpoint.password)throw Error('recovery_endpoint');
const prefix='i015-trial/hourly-live-v1/',bucket='market-pilot-state-trial',client=new S3Client({endpoint:endpoint.origin,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
const allowed=k=>[facebookStateKey,routingKey,'console-config-v1/current.json'].includes(k)||/^facebook-feed-v1\/bases-v1\/[a-f0-9]{64}\.json$/.test(k)||/^console-config-v1\/versions\/\d+-[a-f0-9]{64}\.json$/.test(k)||/^blobs\/[a-f0-9]{64}\.blob$/.test(k);
async function get(k,max=32*1024*1024){if(!allowed(k))throw Error('recovery_key');let r;try{r=await client.send(new GetObjectCommand({Bucket:bucket,Key:prefix+k}));}catch(e){if(e.$metadata?.httpStatusCode===404)return null;throw e;}if(r.ContentLength>max)throw Error('recovery_size');const bytes=Buffer.from(await r.Body.transformToByteArray());if(bytes.length>max)throw Error('recovery_size');return {bytes,etag:r.ETag};}
const transport={async get(k,max){const r=await get(k,max);if(!r||k!==facebookStateKey)return r;const state=await decodeCheckpoint(r.bytes,async key=>(await get(key)).bytes);return {...r,bytes:Buffer.from(JSON.stringify(state))};},async putIf(k,bytes,c){if(!apply||k!==facebookStateKey||bytes.length>32*1024*1024)throw Error('recovery_write_scope');const r=await client.send(new PutObjectCommand({Bucket:bucket,Key:prefix+k,Body:bytes,ContentType:'application/json',...(c.absent?{IfNoneMatch:'*'}:{IfMatch:c.etag})}));return{etag:r.ETag};}};
const cases=[['facebook:a51b9de43642489fde0952f1','0433101792e370c907dd1b8e04a115a1df4e571c6b3d59612b19d192c84d7174'],['facebook:e23d27c268c2f73d7e57ae54','2272b0ffff5772d70bd877ba08f15f63a805776804a8b7a47b5a46514ec8dbf1']];
const receipt={mode:env.RECOVERY_MODE,collectionCalls:0,modelCalls:0,imageDownloads:0,newCards:0,out:[]};let store,owned=false;
try{
 store=await openFacebookStore(transport);const config=await readVersion({get},{expectedReleaseHash:env.MAIN_PACKAGE_SHA}),library=config.version.documents.library;
 const registry=JSON.parse((await get(routingKey,524288)).bytes),routes=decodeRoutes(registry,env.DISCORD_ROUTING_KEY,'1563256161707364382');
 if(apply){const claim=await acquireFacebookLease(store,{runId,now:Date.now(),ttl:10*60000});if(!claim.result)throw Error('fb_recovery_busy');owned=true;}
 for(const [key,evidenceHash]of cases){
  const state=await store.read(),post=state.posts[key],prior=state.fbAnalyses[key],existing=state.feedReceipts?.[key];
  if(existing?.status==='sent'){receipt.out.push({key,status:'already_sent'});continue;}
  if(existing||!post||prior?.status!=='response_rejected'||prior.code!=='fb_evidence_schema'||prior.contentHash!==post.contentHash||prior.responseEvidenceHash!==evidenceHash||Date.now()-Date.parse(prior.startedAt)>86400000)throw Error('fb_recovery_identity');
  const saved=await get('blobs/'+evidenceHash+'.blob',200000);if(!saved||sha(saved.bytes)!==evidenceHash)throw Error('fb_recovery_hash');
  const parsed=decodeReply(saved.bytes.toString());if(!parsed.factsByImage.some(x=>x.value?.scene==='catalog'))throw Error('fb_recovery_not_catalog_case');
  const entry=filterFeedResources(prepareEntry(post,parsed.analysis,{factsByImage:parsed.factsByImage,knownSkinNames:approvedSkinNames(library),gameTerms:approvedGameTerms(library),resourceLibrary:library,acceptBuy:true,currencyActive:true,currencySourceImages:[]}),library);
  if(entry.status!=='candidate'){receipt.out.push({key,status:entry.status});continue;}
  if(!apply){receipt.out.push({key,status:'validated_preview',images:entry.images.length,resources:entry.summary.resources.length});continue;}
  const images=new Map();for(const url of entry.images){receipt.imageDownloads++;const {image}=await prepareFacebookPhoto(post,url,{enabled:false});images.set(url,{data:new Uint8Array(image.bytes),mime:image.mime});}
  const route=routes.find(r=>r.id===registry.active[entry.direction==='buy'?'facebook-buy':'facebook-feed']);if(!route)throw Error('fb_recovery_destination');const destination={guildId:route.guildId,channelId:route.channelId};
  const sender=await discordTransport({webhookUrl:route.url,destination,loadImage:async url=>{if(!images.has(url))throw Error('fb_recovery_image_not_preloaded');return images.get(url);}});
  await store.transact(s=>{if(s.lease?.runId!==runId||s.posts[key].contentHash!==post.contentHash||s.fbAnalyses[key].responseEvidenceHash!==evidenceHash||s.feedReceipts[key])throw Error('fb_recovery_changed');s.fbAnalyses[key]={...prior,status:'completed',phase:'validated_saved_reply',entry,priorFailure:{code:prior.code,phase:prior.phase},recoveredAt:new Date().toISOString()};delete s.fbAnalyses[key].code;});
  const result=await deliverFeed({store,entry,destination,transport:sender});
  await store.transact(s=>{if(result.status==='sent'&&s.fbQueue[key]){s.fbQueue[key].status='completed';s.fbQueue[key].outcome='sent';}s.fbSavedRecoveries??={};s.fbSavedRecoveries[key]={evidenceHash,runId,status:result.status,at:new Date().toISOString()};});
  if(result.status==='sent')receipt.newCards++;receipt.out.push({key,status:result.status});if(result.status!=='sent')break;
 }
}finally{if(owned)await releaseFacebookLease(store,runId);client.destroy();await fs.writeFile('fb-saved-recovery-receipt.json',JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt));
