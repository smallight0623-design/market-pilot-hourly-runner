import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {R2Transport} from './app/cloud-state/r2-transport.mjs';import {ObjectSnapshotStore} from './app/cloud-state/object-store.mjs';
import {readVersion,rebindRelease,publishVersion,validateVersion,hash} from './app/configuration/versions.mjs';
import {applyRunConfig} from './app/configuration/runner-config.mjs';
const env=process.env,plan=JSON.parse(await fs.readFile('stability-plan.json')),sha=b=>createHash('sha256').update(b).digest('hex');
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||sha(await fs.readFile('hourly-package.zip'))!==plan.after)throw Error('release_context');
const github=async path=>{const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'stability-release'},redirect:'error'});if(!r.ok)throw Error('github_'+r.status);return r.json();};
if((await github('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('hourly_not_paused');
for(const run of (await github('/actions/workflows/hourly-push.yml/runs?per_page=5')).workflow_runs.filter(r=>r.status!=='completed')){
 const job=(await github('/actions/runs/'+run.id+'/jobs')).jobs.find(j=>j.name==='hourly');if(!job||job.status!=='completed')throw Error('hourly_active');
}
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:1500,maxUploadBytes:250*1024*1024});
try{
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true,reuseBlobs:true,maxBlobCacheBytes:32*1024*1024}),before=await store.read(),op=before.data.metadata.hourly;
 if(op.publisherReleaseHash!==plan.before)throw Error('live_baseline_changed');
 if(op.lease){const owner=(await github('/actions/runs/'+op.lease.runId+'/jobs')).jobs.find(j=>j.name==='hourly');if(!owner||owner.status!=='completed')throw Error('live_lease_active');}
 const configStore={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,c)=>t.putConfig(k,b,c)};
 let current=await readVersion(configStore,{expectedReleaseHash:plan.before});const previousDocs=structuredClone(current.version.documents);
 const evidence=[];for(const item of plan.recoveries){const bytes=await store.getBlob(item.evidenceHash);if(sha(bytes)!==item.evidenceHash)throw Error('recovery_hash');const saved=JSON.parse(bytes);if(saved.id!==item.id||saved.reply.outcome!=='received'||saved.reply.response.solution.currentUrl!=='https://www.8591.com.tw/v3/mall/detail/'+item.id)throw Error('recovery_source');if(op.records[item.id]?.messageId)throw Error('recovery_already_delivered');evidence.push(item);}
 const id='2420918987',oldRow=op.records[id];if(!oldRow?.messageId||oldRow.askingPrice!==3500||!/利姆路/.test(oldRow.title))throw Error('rimuru_record_changed');
 await rebindRelease(configStore,{expectedOldRelease:plan.before,newRelease:plan.after,expectedHeadHash:current.head.hash});current=await readVersion(configStore,{expectedReleaseHash:plan.after});
 const documents=structuredClone(current.version.documents),skin=documents.library.entries.find(e=>e.name==='伊格 利姆路·坦派斯特');
 if(!skin?.enabled||!skin.possibleResourceEnabled)throw Error('rimuru_not_featured');if(documents.library.entries.some(e=>e.id!==skin.id&&(e.aliases??[]).includes('利姆路')))throw Error('alias_ambiguous');
 skin.aliases=[...new Set([...skin.aliases,'利姆路'])];assert.deepEqual(documents.model,previousDocs.model);assert.deepEqual(documents.tiers,previousDocs.tiers);
 const next=validateVersion({version:1,revision:current.version.revision+1,releaseHash:plan.after,documentHash:hash(documents),documents,parent:{revision:current.version.revision,hash:current.head.hash},change:{id:'stability-rimuru-20261125',at:new Date().toISOString(),scope:'resource_catalog',operations:[],diff:[]}});
 await publishVersion(configStore,next,{current});await applyRunConfig({transport:configStore,root:new URL('./app/',import.meta.url).pathname,releaseHash:plan.after});
 const {mergePossibleResources}=await import('./app/resource-library/possible-resources.mjs'),{calculatePricing,loadPricing}=await import('./app/pricing-model.mjs'),{buildPricingInventory}=await import('./app/pricing-inventory.mjs');
 const row=structuredClone(oldRow);row.analysis=mergePossibleResources(row.analysis,row,documents.library,{separateSellerResources:true});delete row.cardPresentation;delete row.priceViews;
 if(!row.analysis.cardView.featuredResources.includes(skin.name))throw Error('rimuru_text_not_recovered');
 const estimate=calculatePricing(buildPricingInventory(row,undefined,documents.library,documents.model),loadPricing());row.appliedPricingHash=loadPricing().hash;
 await store.transact(data=>{if(hash(data)!==hash(before.data))throw Error('state_changed_before_cutover');const live=data.metadata.hourly;live.publisherReleaseHash=plan.after;live.lease=null;live.detailRecovery??={};for(const item of evidence){live.detailRecovery[item.id]={...item,status:'available'};const c=live.candidates[item.id];if(!c)throw Error('candidate_missing');if(['analysis_unknown','analysis_started','delivery_requires_review'].includes(c.status))throw Error('candidate_held');c.status='pending';}live.records[id]=row;live.stabilityRepair={status:'prepared',at:new Date().toISOString(),id,messageId:row.messageId,release:plan.after};},{expectedRevision:before.revision});
 const {loadDeliveryRoutes}=await import('./app/discord-routing/runtime.mjs'),{deliverySource}=await import('./app/market-sources.mjs'),{compactCard}=await import('./app/discord-card.mjs'),{correctionPayload,verifyIdentity,messageView}=await import('./app/recheck/discord.mjs'),{publishPublicAsk}=await import('./app/public-ask.mjs');
 await loadDeliveryRoutes({get:(k,m)=>t.getDiscord(k,m)},env);const route=deliverySource(row);if(route?.channelId!==row.discordChannelId)throw Error('rimuru_route_changed');const base=env[route.webhookEnv+(row.discordSenderKind==='application'?'_APPLICATION':'')];if(!base)throw Error('route_secret_missing');
 const request=async(url,options={})=>{const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('discord_'+r.status);return r.json();};
 const target=await request(base),url=base+'/messages/'+row.messageId,old=await request(url);verifyIdentity(row,old,target);
 const card=compactCard(row,{askAi:false}),oldPrice=old.embeds.flatMap(e=>e.fields??[]).find(f=>f.name==='價格（台幣）')?.value,question=oldPrice?.split('\n').find(x=>x.startsWith('重建成本'));
 if(question){const publicUrl=await publishPublicAsk(store,row),field=card.embeds[0].fields.find(f=>f.name==='價格（台幣）');field.value=field.value.replace(/^課金重建：.*$/m,question.replace(/https:\/\/market-pilot-[^)\s]+\/a\/[a-f0-9]{64}/g,publicUrl));}
 const payload=correctionPayload(old,card,row.sourceUrl),backup=(await store.putBlob(Buffer.from(JSON.stringify(messageView(old))))).hash;
 await store.transact(data=>Object.assign(data.metadata.hourly.stabilityRepair,{status:'patch_unknown',beforeEvidenceHash:backup}));
 const sent=await request(url+'?with_components=true',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});verifyIdentity(row,sent,target);const checked=await request(url);verifyIdentity(row,checked,target);
 const names=checked.embeds.flatMap(e=>e.fields??[]).map(f=>f.value).join('\n');if(!names.includes(skin.name))throw Error('rimuru_card_not_visible');assert.deepEqual(checked.components??[],old.components??[]);
 await store.transact(data=>Object.assign(data.metadata.hourly.stabilityRepair,{status:'confirmed',estimateTwd:estimate.estimateTwd,checkedAt:new Date().toISOString()}));
 const {publishProjection}=await import('./app/console-projection.mjs');const previous=await t.getProjection('console-projection-v1/body.json',4*1024*1024),ai=previous&&JSON.parse(previous.bytes).capabilities?.ai;
 const projection=await publishProjection({store,transport:t,env:{...env,RELAYROUTER_API_KEY:ai?'available':undefined}});
 const receipt={status:'confirmed',release:plan.after,configurationRevision:next.revision,recoveries:evidence.map(x=>x.id),rimuru:{id,messageId:row.messageId,estimate:estimate.estimateTwd},projection,newMessages:0,sourceCalls:0,modelCalls:0};await fs.writeFile('stability-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{t.close();}
