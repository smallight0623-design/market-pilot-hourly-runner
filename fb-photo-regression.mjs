import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {facebookPhotoAttachments,downloadFacebookImage,createCloudPhotoReader} from './fb-cloud-photo-source.mjs';
if(process.env.CONFIRM_FB_PHOTO_REGRESSION!=='true'){console.log('photo_regression skipped: explicit opt-in required');process.exit(0);}
const ids=['sd_mwt7v8771o3tzg9dhi','sd_mwt5ql9j1wwdzzve5o','sd_mwt3m0u32aib81uwda','sd_mwt1guiwt3a14gax9'];
const results=await Promise.allSettled(ids.map(async id=>{const r=await fetch('https://api.brightdata.com/datasets/v3/snapshot/'+id+'?format=json',{headers:{Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('snapshot_http_'+r.status);return r.json();}));
const pool=[],seen=new Set();
for(const [n,result] of results.entries()){if(result.status!=='fulfilled'){console.log('sample_snapshot_unavailable',ids[n]);continue;}for(const row of result.value){const refs=facebookPhotoAttachments(row);if(!/^https:\/\/www.facebook.com\/groups\/\d+\/posts\/\d+\/?$/.test(row.url??''))continue;for(const [index,ref] of refs.entries()){if(!ref.photoId||seen.has(ref.path)||ref.photoId==='2228186758134890')continue;seen.add(ref.path);const m=/^[sp](\d+)x(\d+)$/.exec(new URL(ref.url).searchParams.get('ctp')??'');const dims=m?[Number(m[1]),Number(m[2])]:null;pool.push({post:{url:row.url,imageAttachments:refs},ref,index:index+1,photoCount:refs.length,hint:dims,small:dims&&Math.max(...dims)<=1024,long:dims&&Math.max(...dims)/Math.min(...dims)>3});}}}
const chosen=[],paths=new Set();const add=c=>{if(c&&!paths.has(c.ref.path)&&chosen.length<8){chosen.push(c);paths.add(c.ref.path);}};
for(const c of pool.filter(x=>x.long).slice(0,2))add(c);
const multi=pool.find(x=>x.small&&x.photoCount>1);if(multi){add(multi);add(pool.find(x=>x.post.url===multi.post.url&&x.ref.path!==multi.ref.path&&x.small));}
for(const c of pool.filter(x=>x.small)){if(chosen.length>=6)break;if(!chosen.some(x=>x.post.url===c.post.url))add(c);}
for(const c of pool.filter(x=>x.small)){if(chosen.length>=6)break;add(c);}
for(const c of pool.filter(x=>!x.small&&!x.long)){if(chosen.length>=8)break;add(c);}
console.log('sample_plan',JSON.stringify({snapshots:ids.length,candidateImages:pool.length,selected:chosen.length,multiPhotoCases:chosen.filter(x=>x.photoCount>1).length,longHintCases:chosen.filter(x=>x.long).length,maxProviderRequests:6,concurrency:2}));
const reader=createCloudPhotoReader({apiKey:process.env.SCRAPPEY_API_KEY,maxPhotoReads:6});
const storage=new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}),prefix='i015-trial/hourly-live-v1/diagnostics/fb-photo-regression/'+process.env.GITHUB_RUN_ID;
let uploaded=0,cursor=0;const report=[];
async function save(key,image){if(uploaded+image.bytes.length>24*1024*1024)return null;uploaded+=image.bytes.length;await storage.send(new PutObjectCommand({Bucket:'market-pilot-state-trial',Key:prefix+'/'+key,Body:image.bytes,ContentType:image.mime,Metadata:{purpose:'temporary-photo-regression'}}));return prefix+'/'+key;}
async function worker(){while(cursor<chosen.length){const caseNumber=++cursor,c=chosen[caseNumber-1],started=Date.now();let original;try{original=await downloadFacebookImage(c.ref.url);}catch(e){const out={case:caseNumber,postUrl:c.post.url,photoId:c.ref.photoId,index:c.index,photoCount:c.photoCount,status:'baseline_unavailable',code:e.message};report.push(out);console.log('sample_result',JSON.stringify(out));continue;}
 const aspect=Math.max(original.width,original.height)/Math.min(original.width,original.height);
 const needs=Math.max(original.width,original.height)<=1024||(aspect>3&&Math.min(original.width,original.height)<=1024);
 const selected=needs?await reader.read(c.post,c.ref.url,original):{...original,status:'already_large_original_retained'};
 const out={case:caseNumber,postUrl:c.post.url,photoId:c.ref.photoId,index:c.index,photoCount:c.photoCount,long:aspect>3,status:selected.status,baseline:{width:original.width,height:original.height,bytes:original.bytes.length,sha256:original.sha256},selected:{width:selected.width,height:selected.height,bytes:selected.bytes.length,sha256:selected.sha256},areaRatio:Number((selected.width*selected.height/(original.width*original.height)).toFixed(3)),candidateCount:selected.candidateCount??0,elapsedSeconds:Math.round((Date.now()-started)/1000)};
 out.baselineKey=await save('case-'+caseNumber+'-baseline.image',original);out.selectedKey=selected.sha256===original.sha256?out.baselineKey:await save('case-'+caseNumber+'-selected.image',selected);report.push(out);console.log('sample_result',JSON.stringify(out));}}
await Promise.all([worker(),worker()]);
const summary={at:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID,providerRequests:reader.reads,samples:report.sort((a,b)=>a.case-b.case),uploadedBytes:uploaded};
await storage.send(new PutObjectCommand({Bucket:'market-pilot-state-trial',Key:prefix+'/report.json',Body:JSON.stringify(summary),ContentType:'application/json'}));
console.log('sample_summary',JSON.stringify({providerRequests:reader.reads,samples:report.length,upgraded:report.filter(x=>x.status==='photo_viewer_larger').length,retained:report.filter(x=>x.selected&&x.status!=='photo_viewer_larger').length,baselineUnavailable:report.filter(x=>x.status==='baseline_unavailable').length,reportKey:prefix+'/report.json'}));
