// Explicit, sealed four-record repair. No source requests, OCR, AI, or new cards.
import fs from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';
import{R2Transport}from'./app/cloud-state/r2-transport.mjs';import{ObjectSnapshotStore}from'./app/cloud-state/object-store.mjs';
import{readVersion,rebindRelease,validateVersion,publishVersion,hash}from'./app/configuration/versions.mjs';
import{applyRunConfig}from'./app/configuration/runner-config.mjs';
const plan=JSON.parse(await fs.readFile('recognition-repair-plan.json')),env=process.env,sha=b=>createHash('sha256').update(b).digest('hex'),runId='recognition-repair-20261125';
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||sha(await fs.readFile('hourly-package.zip'))!==plan.shared.after)throw Error('release_context_invalid');
const github=async path=>{const r=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,'User-Agent':'recognition-repair'},redirect:'error'});if(!r.ok)throw Error('github_'+r.status);return r.json();};
if((await github('/actions/workflows/hourly-push.yml')).state!=='disabled_manually')throw Error('hourly_not_disabled');
for(const workflow of['hourly-push.yml','facebook-resume.yml'])if((await github('/actions/workflows/'+workflow+'/runs?per_page=5')).workflow_runs.some(r=>r.status!=='completed'))throw Error('publisher_not_quiescent');
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:1000,maxUploadBytes:250*1024*1024});
const configStore={get:(k,m)=>t.getConfig(k,m),putIf:(k,b,c)=>t.putConfig(k,b,c)};
try{
 const sealed=await t.get('blobs/'+plan.evidenceHash+'.blob',2*1024*1024);if(!sealed||sha(sealed.bytes)!==plan.evidenceHash)throw Error('repair_evidence_changed');const evidence=JSON.parse(sealed.bytes);
 assert.deepEqual(evidence.results.map(r=>r.id).sort(),['2420902755','2420910597','2420910696','2420911062']);
 let config=await readVersion(configStore);if(![plan.shared.before,plan.shared.after].includes(config.version.releaseHash))throw Error('config_release_changed');
 const desired=evidence.documentsAfter;if(config.version.documentHash!==evidence.configDocumentHash&&hash(config.version.documents)!==hash(desired))throw Error('formal_prices_changed');
 assert.deepEqual(config.version.documents.model,desired.model);assert.deepEqual(config.version.documents.tiers,desired.tiers);
 const store=new ObjectSnapshotStore(t,{compressSnapshots:true,cacheSnapshots:true}),before=await store.read(),op=before.data.metadata.hourly;
 if(!op.enabled||![plan.shared.before,plan.shared.after].includes(op.publisherReleaseHash))throw Error('live_release_changed');
 if(op.lease){if(Date.parse(op.lease.expiresAt)>Date.now()||(await github('/actions/runs/'+op.lease.runId)).status!=='completed')throw Error('live_lease_active');}
 for(const repair of evidence.results){const row=op.records[repair.id];if(row?.contentHash!==repair.sourceContentHash||row.excluded||row.display?.removedAt||!row.messageId)throw Error('repair_record_changed');assert.deepEqual(row.hourlyImages.map(i=>i.sha256),repair.sourceImages);}
 const pub=await t.getCatalog('console-catalog-v1/publication.json',2*1024*1024);if(pub&&['queued','building'].includes(JSON.parse(pub.bytes).status))throw Error('catalog_publication_pending');
 // Immutable reference objects were uploaded and checksum-verified before dispatch.
 for(const[hashValue,ext]of[[evidence.reference.metadataHash,'json'],[evidence.reference.npzHash,'npz']]){const o=await t.getCatalog('console-catalog-v1/features/'+hashValue+'.'+ext,40*1024*1024);if(!o||sha(o.bytes)!==hashValue)throw Error('reference_object_missing');}
 if(config.version.releaseHash===plan.shared.before){await rebindRelease(configStore,{expectedOldRelease:plan.shared.before,newRelease:plan.shared.after,expectedHeadHash:config.head.hash});config=await readVersion(configStore);}
 if(config.version.documentHash!==hash(desired)){
  const next=validateVersion({version:1,revision:config.version.revision+1,releaseHash:plan.shared.after,documentHash:hash(desired),documents:desired,parent:{revision:config.version.revision,hash:config.head.hash},change:{id:runId+'-reference',at:new Date().toISOString(),scope:'resource_reference_repair',operations:[],diff:[{name:'霧己 紅丸',addedReferences:1,pricingChanged:false}]}});
  await publishVersion(configStore,next,{current:config});config=await readVersion(configStore);
 }
 await applyRunConfig({transport:configStore,root:'./app',releaseHash:plan.shared.after});
 const{adoptedPatternReport,applyRankEvidence}=await import('./app/recognition/authority.mjs'),{validateAdoptedReport}=await import('./app/recognition/runtime.mjs'),{applyPatternSkinAuthority}=await import('./app/cloud-state/pattern-authority.mjs'),{mergePossibleResources}=await import('./app/resource-library/possible-resources.mjs'),{bindingClass,buildPricingInventory}=await import('./app/pricing-inventory.mjs'),{calculatePricing,loadPricing}=await import('./app/pricing-model.mjs'),{compactCard}=await import('./app/discord-card.mjs'),{loadDeliveryRoutes}=await import('./app/discord-routing/runtime.mjs'),{deliverySource}=await import('./app/market-sources.mjs'),{correctionPayload,verifyIdentity,messageView}=await import('./app/recheck/discord.mjs');
 const documents=config.version.documents,pricing=loadPricing(),updates=[];
 for(const repair of evidence.results){
  const row=structuredClone(op.records[repair.id]),report=repair.report;
  for(const image of report.images){assert.equal(image.sourceSha256,row.hourlyImages[image.imageIndex-1].sha256);assert(image.skins.matches.every(m=>m.inliers>=12||m.adaptiveVerified===true));}
  row.analysis=applyPatternSkinAuthority(row.analysis,row,documents.library,{report:adoptedPatternReport(report,documents.library),sourceImages:row.hourlyImages});row.analysis.currencyPattern=report;row.analysis=applyRankEvidence(row.analysis,row,report,row.hourlyImages);row.analysis=mergePossibleResources(row.analysis,row,documents.library,{separateSellerResources:true});
  row.pricingEvidence={version:1,sourceContentHash:row.contentHash,assets:row.analysis.pricingAssets,bindingClass:bindingClass(row,documents.model)};row.appliedPricingHash=pricing.hash;
  const estimate=calculatePricing(buildPricingInventory(row,undefined,documents.library,documents.model),pricing);assert.equal(estimate.estimateTwd,repair.expected.newEstimate);assert.equal(row.analysis.cardView.highestRank,repair.expected.history);updates.push({row,estimate,repair});
 }
 await store.transact(data=>{if(hash(data)!==hash(before.data))throw Error('live_state_changed');const live=data.metadata.hourly;live.publisherReleaseHash=plan.shared.after;live.lease=null;live.recognitionRepairs??={};for(const{row}of updates){const previous=live.recognitionRepairs[row.id];if(previous?.status==='patch_unknown')throw Error('prior_patch_requires_review');live.records[row.id]=row;live.recognitionRepairs[row.id]={status:previous?.status==='confirmed'?'confirmed':'prepared',runId,sourceContentHash:row.contentHash,messageId:row.messageId,at:new Date().toISOString()};}},{expectedRevision:before.revision});
 await loadDeliveryRoutes({get:(k,m)=>t.getDiscord(k,m)},env);
 const request=async(url,init={})=>{for(let attempt=0;attempt<3;attempt++){const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});if(r.status===429){const seconds=Number((await r.json()).retry_after);if(!Number.isFinite(seconds)||seconds>50||attempt===2)throw Error('discord_rate_limited');await new Promise(resolve=>setTimeout(resolve,seconds*1000+250));continue;}if(!r.ok)throw Error('discord_http_'+r.status);return r.json();}};
 const receipts=[];
 for(const{row,estimate}of updates){
  const state=(await store.read()).data.metadata.hourly;if(state.recognitionRepairs[row.id].status==='confirmed'){receipts.push({id:row.id,status:'previously_confirmed'});continue;}
  const route=deliverySource(row);if(!route||route.channelId!==row.discordChannelId)throw Error('card_route_changed');const base=env[route.webhookEnv+(row.discordSenderKind==='application'?'_APPLICATION':'')];if(!base)throw Error('card_route_missing');const target=await request(base),url=new URL(base+'/messages/'+row.messageId);url.searchParams.set('with_components','true');
  const old=await request(url);verifyIdentity(row,old,target);const publicQuestionUrl=old.embeds?.flatMap(e=>e.fields??[]).map(f=>f.value).join('\n').match(/https:\/\/market-pilot-public-ask[^)\s]+/)?.[0];
  const card=compactCard(row,{askAi:false});const oldPrice=old.embeds.flatMap(e=>e.fields??[]).find(f=>f.name==='價格（台幣）')?.value,price=card.embeds[0].fields.find(f=>f.name==='價格（台幣）');if(oldPrice&&price){const questionLine=oldPrice.split('\n').find(s=>s.startsWith('重建成本'));if(questionLine)price.value=price.value.replace(/^課金重建：.*$/m,questionLine);}
  const payload=correctionPayload(old,card,row.sourceUrl),backup=(await store.putBlob(Buffer.from(JSON.stringify(messageView(old))))).hash;
  await store.transact(data=>{const p=data.metadata.hourly.recognitionRepairs[row.id];if(p.status!=='prepared')throw Error('patch_state_changed');Object.assign(p,{status:'patch_unknown',beforeEvidenceHash:backup});});
  const sent=await request(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});verifyIdentity(row,sent,target);const checked=await request(url);verifyIdentity(row,checked,target);
  const norm=a=>(a??[]).map(f=>({name:f.name,value:f.value,inline:f.inline??false}));assert.deepEqual(norm(checked.embeds.find(e=>e.url===row.sourceUrl).fields),norm(card.embeds[0].fields));assert.deepEqual(checked.components??[],old.components??[]);assert.equal(checked.embeds.filter(e=>e.image).length,old.embeds.filter(e=>e.image).length);
  const afterEvidenceHash=(await store.putBlob(Buffer.from(JSON.stringify(messageView(checked))))).hash;
  await store.transact(data=>Object.assign(data.metadata.hourly.recognitionRepairs[row.id],{status:'confirmed',afterEvidenceHash,estimateTwd:estimate.estimateTwd,checkedAt:new Date().toISOString()}));receipts.push({id:row.id,messageId:row.messageId,estimate:estimate.estimateTwd,history:row.analysis.cardView.highestRank,status:'confirmed'});
 }
 const{publishProjection}=await import('./app/console-projection.mjs');const priorProjection=await t.getProjection('console-projection-v1/body.json',2*1024*1024),aiAvailable=priorProjection&&JSON.parse(priorProjection.bytes).capabilities?.ai===true;await publishProjection({store,transport:t,env:{...env,RELAYROUTER_API_KEY:aiAvailable?'available':undefined}});
 await fs.writeFile('recognition-repair-receipt.json',JSON.stringify({at:new Date().toISOString(),releaseHash:plan.shared.after,configurationRevision:config.version.revision,records:receipts,sourceCalls:0,modelCalls:0,newCards:0},null,2));console.log(JSON.stringify({status:'confirmed',cards:receipts.length,sourceCalls:0,modelCalls:0}));
}finally{t.close();}
