// Component-only maintenance: no source fetching, AI calls, card content or state mutations.
import fs from 'node:fs/promises';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {decodeCheckpoint} from './fb-estimator-checkpoint.mjs';
import {decodeRoutes,validateRegistry} from './app/facebook/registry.mjs';
import {fbFavoriteButtons} from './app/facebook/favorites.mjs';
const prefix='i015-trial/hourly-live-v1/',sdk=new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',maxAttempts:1,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
async function read(key){const r=await sdk.send(new GetObjectCommand({Bucket:'market-pilot-state-trial',Key:prefix+key}));if(r.ContentLength>32*1024*1024)throw Error('state_limit');return Buffer.from(await r.Body.transformToByteArray());}
try{
 const bytes=await read('facebook-feed-v1/state.json'),raw=JSON.parse(bytes),state=raw.format==='fb-delta-v1'?await decodeCheckpoint(bytes,read):raw;
 const registry=validateRegistry(JSON.parse(await read('console-facebook-discord-v1/current.json')),'1563256161707364382'),routes=decodeRoutes(registry,process.env.DISCORD_ROUTING_KEY,'1563256161707364382');
 let favorites={cards:{}};try{favorites=JSON.parse(await read('facebook-feed-v1/favorites.json'));}catch(e){if(e.name!=='NoSuchKey')throw e;}
 const keys=Object.keys(state.feedReceipts??{}).filter(k=>{const r=state.feedReceipts[k],e=state.fbAnalyses?.[k]?.entry;return r.status==='sent'&&!r.removedAt&&e?.status==='candidate'&&e.direction!=='buy'&&Date.now()-Date.parse(state.posts[k]?.publishedAt)<7*86400000;}).sort((a,b)=>Date.parse(state.posts[b]?.publishedAt)-Date.parse(state.posts[a]?.publishedAt)).slice(0,10);
 const results=[];
 for(const key of keys){const receipt=state.feedReceipts[key],entry=state.fbAnalyses[key].entry,route=routes.find(r=>r.id===registry.active['facebook-feed']&&r.slot==='facebook-feed');if(!route||route.guildId!==receipt.guildId||route.channelId!==receipt.channelId){results.push({key,status:'route_not_confirmed'});continue;}
  const id=receipt.messages?.[0]?.messageId;if(!/^\d{17,20}$/.test(id??''))continue;
  const url=new URL(route.url+'/messages/'+id);
  const request=async(options={})=>{const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status===404)return null;if(!r.ok)throw Error('discord_http_'+r.status);return r.json();};
  const before=await request();if(!before){results.push({key,status:'missing'});continue;}
  if(before.id!==id||before.channel_id!==route.channelId||before.webhook_id!==route.webhookId||before.embeds?.[0]?.url!==state.posts[key].url)throw Error('card_identity_changed');
  const components=fbFavoriteButtons(key,!!favorites.cards[key]?.favorite,true);
  const after=await request({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({components,allowed_mentions:{parse:[]}})});
  const stable=m=>JSON.stringify({content:m.content,embeds:m.embeds,attachments:m.attachments});
  if(!after||stable(after)!==stable(before)||!after.components?.some(row=>row.components?.some(b=>b.url===components[0].components[1].url)))throw Error('card_readback_failed');
  results.push({key,messageId:id,status:'updated'});
 }
 await fs.writeFile('fb-estimator-receipt.json',JSON.stringify({at:new Date().toISOString(),sourceCalls:0,modelCalls:0,stateWrites:0,results},null,2));console.log(JSON.stringify({updated:results.filter(r=>r.status==='updated').length,skipped:results.filter(r=>r.status!=='updated').length}));
}finally{sdk.destroy();}
