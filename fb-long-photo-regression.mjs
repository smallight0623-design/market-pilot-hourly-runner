import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {facebookPhotoAttachments,downloadFacebookImage,recoverFacebookPhoto} from './fb-cloud-photo-source.mjs';
if(process.env.CONFIRM_FB_LONG_PHOTO!=='true'){console.log('long_photo_test skipped');process.exit(0);}
const postUrl='https://www.facebook.com/groups/1281285633578012/posts/1744724823900755/';
const auth={Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`,'Content-Type':'application/json'};
async function bd(path,options={}){const r=await fetch('https://api.brightdata.com/datasets/v3/'+path,{...options,headers:auth,signal:AbortSignal.timeout(65000)});if(!r.ok)throw Error('brightdata_http_'+r.status);return r.json();}
const saved=process.env.FB_LONG_SOURCE_SNAPSHOT??'';if(saved&&!/^sd_[A-Za-z0-9]{8,80}$/.test(saved))throw Error('source_snapshot_invalid');
let rows=saved?await bd('snapshot/'+saved+'?format=json'):await bd('scrape?dataset_id=gd_lyclm1571iy3mv57zw&format=json&include_errors=true',{method:'POST',body:JSON.stringify([{url:postUrl}])});
if(rows.snapshot_id){const id=rows.snapshot_id;console.log('long_photo_snapshot',id);for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,10000));const p=await bd('progress/'+id);console.log('long_photo_progress',p.status);if(p.status==='ready'){rows=await bd('snapshot/'+id+'?format=json');break;}if(p.status==='failed')throw Error('source_failed');}}
if(!Array.isArray(rows))throw Error('source_pending');
const row=rows.find(x=>facebookPhotoAttachments(x).length);if(!row)throw Error('source_photos_missing');
const refs=facebookPhotoAttachments(row);console.log('long_photo_source',JSON.stringify({postUrl,photoCount:refs.length}));
const originals=[];for(const [index,ref] of refs.slice(0,10).entries()){try{const original=await downloadFacebookImage(ref.url);originals.push({index:index+1,ref,original});console.log('long_photo_baseline',JSON.stringify({index:index+1,photoId:ref.photoId,width:original.width,height:original.height,bytes:original.bytes.length}));}catch(e){console.log('long_photo_baseline_unavailable',index+1,e.message);}}
const vertical=originals.filter(x=>x.original.height/x.original.width>=3);
const targets=(vertical.length?vertical:originals).slice(0,2);if(!targets.length)throw Error('source_photo_not_downloaded');
console.log('long_photo_selection',JSON.stringify({verticalPreviews:vertical.length,targets:targets.length,checkingPossibleCroppedPreview:!vertical.length}));
const s3=new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}),prefix='i015-trial/hourly-live-v1/diagnostics/fb-photo-regression/'+process.env.GITHUB_RUN_ID;
const report=[];
for(const target of targets){const {ref,original,index}=target;const start=Date.now();const selected=await recoverFacebookPhoto({photoId:ref.photoId,postUrl,originalUrl:ref.url,original,apiKey:process.env.SCRAPPEY_API_KEY});
const result={index,photoId:ref.photoId,status:selected.status,verticalLongSelected:selected.height/selected.width>=3,baseline:{width:original.width,height:original.height,bytes:original.bytes.length,sha256:original.sha256},selected:{width:selected.width,height:selected.height,bytes:selected.bytes.length,sha256:selected.sha256},candidateCount:selected.candidateCount,checks:selected.checks,elapsedSeconds:Math.round((Date.now()-start)/1000)};
for(const [kind,image] of [['baseline',original],['selected',selected]]){const key=prefix+'/long-'+index+'-'+kind+'.image';await s3.send(new PutObjectCommand({Bucket:'market-pilot-state-trial',Key:key,Body:image.bytes,ContentType:image.mime,Metadata:{purpose:'temporary-photo-regression'}}));result[kind+'Key']=key;}
report.push(result);console.log('long_photo_result',JSON.stringify(result));}
await s3.send(new PutObjectCommand({Bucket:'market-pilot-state-trial',Key:prefix+'/report.json',Body:JSON.stringify({postUrl,samples:report}),ContentType:'application/json'}));console.log('long_photo_report_key',prefix+'/report.json');
