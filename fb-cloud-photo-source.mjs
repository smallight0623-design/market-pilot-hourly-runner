import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest('hex');
const mediaUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(fbcdn\.net|fbsbx\.com)$/.test(u.hostname)?u:null;}catch{return null;}};
export const photoMonthlyLimit=1000;

export function reservePhotoRequest(state,{runId,photoId,sourceSha256,at=Date.now()}){
 if(typeof runId!=='string'||!runId||runId.length>120||!/^\d{5,30}$/.test(String(photoId))||!/^[a-f0-9]{64}$/.test(sourceSha256??''))return false;
 const month=new Date(at+8*3600000).toISOString().slice(0,7),old=state.fbPhotoBudget;
 if(old&&(old.version!==1||!/^\d{4}-\d{2}$/.test(old.month)||old.month>month||!Number.isSafeInteger(old.used)||old.used<0||typeof old.reservations!=='object'||!old.reservations||Array.isArray(old.reservations)))return false;
 const budget=old?.month===month?old:{version:1,month,used:0,reservations:{}};
 const key=digest(Buffer.from(runId+'|'+photoId+'|'+sourceSha256));
 if(budget.used>=photoMonthlyLimit||budget.reservations[key])return false;
 budget.used++;budget.reservations[key]=new Date(at).toISOString();state.fbPhotoBudget=budget;return true;
}

export function facebookPhotoAttachments(row){
 const out=[];
 for(const a of row.attachments??[]){
  if(!/^(?:photo|image)$/i.test(a?.type??''))continue;
  const u=[a.downloadable_url,a.url].map(mediaUrl).find(Boolean);
  if(!u||out.some(x=>x.url===u.href))continue;
  const id=String(a.id??'');out.push({url:u.href,photoId:/^\d{5,30}$/.test(id)?id:null,path:u.pathname});
 }
 return out;
}

export function observedPhotoUrls(html,path,domImages=[]){
 const urls=new Set();
 const add=value=>{const u=mediaUrl(value);if(u?.pathname===path)urls.add(u.href);};
 for(const i of domImages)add(i.url);
 for(const match of String(html).matchAll(/"(https?:[^"\r\n]+)"/g)){
  let value;try{value=JSON.parse('"'+match[1]+'"');}catch{value=match[1];}
  add(value.replace(/&amp;|&#0*38;|&#x0*26;/gi,'&'));
 }
 return [...urls].slice(0,20);
}

export function imageDimensions(b){
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),mime:'image/png'};
 if(b[0]===255&&b[1]===216)for(let i=2;i+9<b.length;){
  if(b[i]!==255)break;const marker=b[i+1];if(marker===217||marker===218)break;
  const n=b.readUInt16BE(i+2);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5),mime:'image/jpeg'};
  if(n<2||i+n+2>b.length)break;i+=n+2;
 }
 if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  const format=b.toString('ascii',12,16);
  if(format==='VP8X')return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3),mime:'image/webp'};
  if(format==='VP8L'&&b[20]===0x2f){const n=b.readUInt32LE(21);return {width:(n&0x3fff)+1,height:((n>>>14)&0x3fff)+1,mime:'image/webp'};}
  if(format==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a)return {width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff,mime:'image/webp'};
 }
 return null;
}

async function readBounded(response,maxBytes){
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes){await response.body.cancel?.().catch(()=>{});throw Error('photo_size_limit');}chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}

export async function downloadFacebookImage(url,{fetcher=fetch,maxBytes=6*1024*1024}={}){
 if(!mediaUrl(url))throw Error('photo_media_url_invalid');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('photo_image_http_'+response.status);
 const bytes=await readBounded(response,maxBytes),dimensions=imageDimensions(bytes);
 if(!dimensions||dimensions.width<1||dimensions.height<1)throw Error('photo_image_format');
 return {url,bytes,...dimensions,sha256:digest(bytes)};
}

// One explicitly budgeted provider request, using a public photo ID retained from
// the paid source record. No user cookies, login actions or signed URL rewrites.
export async function recoverFacebookPhoto({photoId,postUrl,originalUrl,original,apiKey,fetcher=fetch,maxBytes=6*1024*1024}){
 const fallback=(status,extra={})=>({...original,url:originalUrl,status,...extra});
 const originalMedia=mediaUrl(originalUrl);
 let post;try{post=new URL(postUrl);}catch{return fallback('photo_metadata_missing');}
 const match=/^\/groups\/(\d+)\/posts\/(\d+)\/?$/.exec(post.pathname);
 if(!/^\d{5,30}$/.test(String(photoId))||post.protocol!=='https:'||!['www.facebook.com','facebook.com'].includes(post.hostname)||post.username||post.password||!match||!originalMedia)return fallback('photo_metadata_missing');
 if(!apiKey)return fallback('photo_provider_disabled');
 const source=new URL('https://www.facebook.com/photo');source.searchParams.set('fbid',photoId);source.searchParams.set('set','gm.'+match[2]);source.searchParams.set('idorvanity',match[1]);
 const path=originalMedia.pathname;
 const code=`(() => ({path:location.pathname,images:[...document.images].filter(i=>{try{return new URL(i.currentSrc||i.src).pathname===${JSON.stringify(path)}}catch{return false}}).map(i=>({url:i.currentSrc||i.src,width:i.naturalWidth,height:i.naturalHeight}))}))()`;
 let body;
 try{
  const response=await fetcher('https://publisher.scrappey.com/api/v1?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(120000),body:JSON.stringify({cmd:'request.get',url:source.href,proxyCountry:'Taiwan',browserActions:[{type:'wait',wait:5},{type:'execute_js',code}]})});
  if(!response.ok)return fallback('photo_provider_http',{httpStatus:response.status});
  body=JSON.parse(await readBounded(response,8*1024*1024));
 }catch{return fallback('photo_provider_unavailable');}
 const s=body.solution;
 if(body.data!=='success'||s?.statusCode!==200)return fallback('photo_provider_response_invalid');
 let current;try{current=new URL(s.currentUrl??source.href);}catch{return fallback('photo_provider_response_invalid');}
 if(current.protocol!=='https:'||!['www.facebook.com','facebook.com'].includes(current.hostname)||!/^\/photo(?:\.php)?\/?$/.test(current.pathname))return fallback('photo_page_unavailable');
 const states=(Array.isArray(s.javascriptReturn)?s.javascriptReturn:[]).flat().filter(x=>x&&Array.isArray(x.images));
 const urls=observedPhotoUrls(s.response??'',path,states.flatMap(x=>x.images));
 // Prefer larger advertised renditions, but always measure downloaded bytes.
 const sizeHint=url=>{const u=new URL(url),m=/^[sp](\d+)x(\d+)$/.exec(u.searchParams.get('ctp')??'');return m?Number(m[1])*Number(m[2]):0;};
 urls.sort((a,b)=>sizeHint(b)-sizeHint(a));
 let best=original;const checks=[];
 for(const url of urls.slice(0,3)){
  try{const image=await downloadFacebookImage(url,{fetcher,maxBytes});checks.push({width:image.width,height:image.height,bytes:image.bytes.length,sha256:image.sha256});if(image.width*image.height>best.width*best.height&&image.width>=original.width&&image.height>=original.height)best=image;}
  catch(error){checks.push({code:/^photo_image_http_\d{3}$/.test(error.message)?error.message:'photo_image_unavailable'});}
 }
 return {...best,url:best===original?originalUrl:best.url,status:best!==original?'photo_viewer_larger':checks.some(x=>x.width>0&&x.height>0)?'no_larger_photo':'photo_media_unavailable',candidateCount:urls.length,checks};
}

export function createCloudPhotoReader({apiKey,fetcher=fetch,maxPhotoReads=8,clock=Date.now,claim=null}={}){
 if(!Number.isInteger(maxPhotoReads)||maxPhotoReads<0||maxPhotoReads>100)throw Error('photo_budget_invalid');
 const cache=new Map();let reads=0,attempts=0;
 return {get reads(){return reads;},async read(post,url,original){
  const reference=post.imageAttachments?.find(x=>x.url===url||x.path===mediaUrl(url)?.pathname);
  if(!apiKey)return {...original,url,status:'photo_provider_disabled'};
  if(!reference?.photoId)return {...original,url,status:'photo_metadata_missing'};
  const key=reference.photoId+':'+reference.path+':'+original.sha256;
  if(cache.has(key))return cache.get(key);
  const receipt=post.imageQuality?.images?.find(x=>x.image===reference.image&&x.baseline?.sha256===original.sha256);
  const checkedAt=receipt?.checkedAt??post.imageQuality?.observedAt;
  const age=clock()-Date.parse(checkedAt??'');
  if(receipt&&age>=0){
   if(receipt.selectedUri&&mediaUrl(receipt.selectedUri)?.pathname===mediaUrl(url)?.pathname){
    try{const image=await downloadFacebookImage(receipt.selectedUri,{fetcher});if(image.width>=original.width&&image.height>=original.height&&image.width*image.height>original.width*original.height)return {...image,status:'photo_cached_larger',checkedAt};}catch{}
   }
   if(age<24*3600000&&(receipt.status==='no_larger_photo'||receipt.status==='photo_recently_checked_original_retained'))return {...original,url,status:'photo_recently_checked_original_retained',checkedAt};
   if(age<15*60000&&/^photo_(?:provider|page|media)/.test(receipt.status))return {...original,url,status:'photo_retry_deferred',checkedAt};
  }
  if(attempts>=maxPhotoReads)return {...original,url,status:'photo_budget_deferred'};
  attempts++;
  const promise=(async()=>{
   if(claim){try{const permission=await claim({photoId:reference.photoId,sourceSha256:original.sha256});if(permission!==true)return {...original,url,status:['photo_window_deferred','photo_monitor_paused'].includes(permission)?permission:'photo_month_budget_deferred'};}catch{return {...original,url,status:'photo_budget_unavailable'};}}
   reads++;
   return recoverFacebookPhoto({photoId:reference.photoId,postUrl:post.url,originalUrl:url,original,apiKey,fetcher});
  })().then(result=>({...result,checkedAt:new Date(clock()).toISOString()}));cache.set(key,promise);return promise;
 },async close(){}};
}

export async function prepareFacebookPhoto(post,url,{reader,enabled=false,fetcher=fetch}={}){
 const baseline=await downloadFacebookImage(url,{fetcher});
 const aspect=Math.max(baseline.width,baseline.height)/Math.min(baseline.width,baseline.height);
 const needsLarger=Math.max(baseline.width,baseline.height)<=1024||(aspect>3&&Math.min(baseline.width,baseline.height)<=1024);
 const image=enabled&&needsLarger?await reader.read(post,url,baseline):{...baseline,status:'original_retained'};
 return {image,quality:{status:image.status,checkedAt:image.checkedAt??null,baseline:{width:baseline.width,height:baseline.height,sha256:baseline.sha256},selected:{width:image.width,height:image.height,sha256:image.sha256},candidateCount:image.candidateCount??0,...(image.width*image.height>baseline.width*baseline.height?{selectedUri:image.url}:{})}};
}
