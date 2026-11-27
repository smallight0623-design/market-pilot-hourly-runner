import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
import {R2Transport} from './app/cloud-state/r2-transport.mjs';import {ObjectSnapshotStore} from './app/cloud-state/object-store.mjs';import {runAdoptedRecognition} from './app/recognition/runtime.mjs';
const env=process.env,plan=JSON.parse(await fs.readFile('crop-plan.json')),test=JSON.parse(await fs.readFile('app/recognition/crop-recheck-cases.json')),hash=b=>createHash('sha256').update(b).digest('hex'),variant=env.CROP_VARIANT;
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='smallight0623-design/market-pilot-hourly-runner'||!['main','facebook'].includes(variant))throw Error('qualification_context');
const appHash=hash(await fs.readFile('hourly-package.zip'));assert.equal(appHash,variant==='main'?plan.after:plan.facebookAfter);
const t=new R2Transport({endpoint:env.R2_ENDPOINT,bucket:'market-pilot-state-trial',prefix:'i015-trial/hourly-live-v1',accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},{maxRequests:30,maxUploadBytes:2*1024*1024});
try{
 const bank=test.referenceBank;
 for(const [sha,suffix,file] of [[bank.metadataHash,'json','reference-bank.json'],[bank.npzHash,'npz','reference-bank.npz']]){const obj=await t.getCatalog('console-catalog-v1/features/'+sha+'.'+suffix,40*1024*1024);assert(obj);assert.equal(hash(obj.bytes),sha);await fs.writeFile('app/visual-pattern/engine/'+file,obj.bytes);}
 const bytes=await fs.readFile('app/recognition/'+test.source.file);assert.equal(hash(bytes),test.source.sha256);
 const report=await runAdoptedRecognition([{bytes}],{productId:test.source.productId,skinBank:bank,maxSeconds:300}),image=report.images[0],ids=new Set(image.skins.matches.map(m=>m.libraryId));
 for(const id of test.baselineIds)assert(ids.has(id),'baseline_identity_retained');assert(ids.has(test.requiredNewIdentity),'required_target_detected');
 const m=image.skins.matches.find(m=>m.libraryId===test.requiredNewIdentity),crop=image.skins.cropRecheck;assert.equal(m.route,'crop_recheck12');assert.equal(m.cropRecheckVerified,true);assert.equal(crop.status,'completed');assert(crop.elapsedSeconds<=test.maxAdditionalSeconds);
 const negatives=await new Promise((resolve,reject)=>{const p=spawn('python3',['app/recognition/crop_negative_acceptance.py'],{env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();const timer=setTimeout(()=>{p.kill();reject(Error('negative_check_timeout'));},45000);p.once('error',reject);p.once('close',code=>{clearTimeout(timer);if(code)reject(Error('negative_check_failed'));else try{resolve(JSON.parse(out));}catch{reject(Error('negative_check_format'));}});});
 const store=new ObjectSnapshotStore(t),blob=await store.putBlob(Buffer.from(JSON.stringify({version:1,kind:'crop-recheck-qualification',appHash,sourceSha256:test.source.sha256,report})));
 const receipt={status:'verified',variant,appHash,sourceSha256:test.source.sha256,reportEvidenceHash:blob.hash,baselineCount:test.baselineIds.length,matches:image.skins.matches.length,newTarget:m.libraryId,cropSeconds:crop.elapsedSeconds,negativeCases:negatives.cases.length,modelCalls:0,sourceCalls:0,newMessages:0};await fs.writeFile('crop-qualification.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{t.close();}
