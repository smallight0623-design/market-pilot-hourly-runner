import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateAdoptedReport} from './app/recognition/runtime.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function qualifyCropRelease({plan,get,store,current}){
 if(!plan.qualificationRequired)return null;
 const run=await get('/actions/runs/'+plan.qualificationRunId);
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.path,'.github/workflows/crop-validation.yml');assert.equal(run.head_sha,plan.qualificationHead);
 const test=JSON.parse(await fs.readFile('app/recognition/crop-recheck-cases.json'));
 const bank=current.version.documents.library.catalog.featureBank;
 // Use the manifest actually passed to the matcher, not an entry-name shortcut.
 for(const k of ['metadataHash','npzHash','fingerprint'])assert.equal(bank?.[k],test.referenceBank[k],'formal_reference_bank_changed');
 const bytes=await fs.readFile('app/recognition/'+test.source.file);assert.equal(sha(bytes),test.source.sha256);
 let mainReport;
 for(const variant of ['main','facebook']){
  const receipt=plan.qualifications?.[variant];assert.equal(receipt?.status,'verified');assert.equal(receipt.variant,variant);assert.equal(receipt.appHash,variant==='main'?plan.after:plan.facebookAfter);assert.equal(receipt.sourceSha256,test.source.sha256);assert.equal(receipt.negativeCases,3);
  for(const k of ['modelCalls','sourceCalls','newMessages'])assert.equal(receipt[k],0);
  const raw=await store.getBlob(receipt.reportEvidenceHash);assert.equal(sha(raw),receipt.reportEvidenceHash);const saved=JSON.parse(raw);
  assert.equal(saved.kind,'crop-recheck-qualification');assert.equal(saved.appHash,receipt.appHash);assert.equal(saved.sourceSha256,test.source.sha256);
  const report=validateAdoptedReport(saved.report,[{bytes}],{...test.referenceBank,referenceCount:saved.report.skinBankIdentity.referenceCount});
  const image=report.images[0],ids=new Set(image.skins.matches.map(m=>m.libraryId));for(const id of test.baselineIds)assert(ids.has(id));
  assert.equal(image.skins.cropRecheck.status,'completed');assert(image.skins.cropRecheck.elapsedSeconds<=test.maxAdditionalSeconds);
  const m=image.skins.matches.find(m=>m.libraryId===test.requiredNewIdentity);assert.equal(m?.route,'crop_recheck12');assert.equal(m.cropRecheckVerified,true);
  if(variant==='main')mainReport=report;
 }
 return mainReport;
}

