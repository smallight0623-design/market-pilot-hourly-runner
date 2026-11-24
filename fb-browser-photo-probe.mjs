// Explicitly opted-in, single-request cloud-browser probe. No production state or cards.
import { createHash } from 'node:crypto';
const optedIn=process.env.RUN_FB_BROWSER_PHOTO_PROBE==='true';
if(!optedIn){console.log('photo_browser_probe skipped: explicit opt-in required');process.exit(0);}
if(!process.env.SCRAPPEY_API_KEY)throw Error('scrappey_key_missing');
const target='927091456_2228186761468223_8620341231684829677_n.jpg';
const selector='a[href*="/photo"][href*="2228186758134890"]';
const visibleLogin=`[...document.querySelectorAll('input[type="password"]')].some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)`;
const inspect=stage=>`(() => {const text=document.body?.innerText||'';return {stage:${JSON.stringify(stage)},path:location.pathname,title:document.title,textLength:text.length,imageCount:document.images.length,loginRequired:${visibleLogin},pageSignals:{unavailable:/content isn't available|content is not available|此內容目前無法顯示|內容不存在/i.test(text),loginPrompt:/log in to|log into facebook|登入 Facebook|登录 Facebook|See more on Facebook/i.test(text),cookiePrompt:/allow all cookies|accept all cookies|允許所有 Cookie|允許所有cookie|允許所有 Cookie/i.test(text),verification:/confirm you're human|confirm your identity|驗證你的身分/i.test(text)},photoLinks:[...document.querySelectorAll('a[href*="/photo"]')].slice(0,8).map(a=>({path:new URL(a.href,location.href).pathname,target:a.href.includes('2228186758134890')})),photoAnchors:document.querySelectorAll(${JSON.stringify(selector)}).length,images:[...document.images].filter(i=>(i.currentSrc||i.src).includes(${JSON.stringify(target)})).map(i=>({url:i.currentSrc||i.src,width:i.naturalWidth,height:i.naturalHeight}))}})()`;
const photoPage=process.env.FB_PHOTO_PROBE_PAGE==='photo';
const source=photoPage?'https://www.facebook.com/photo?fbid=2228186758134890&set=gm.1690237639314591&idorvanity=331505628521139':'https://www.facebook.com/groups/331505628521139/posts/1690237639314591/';
const payload={cmd:'request.get',url:source,proxyCountry:'Taiwan',browserActions:photoPage?[
 {type:'wait',wait:5},
 {type:'execute_js',code:inspect('after_photo_click')}
]:[
 {type:'wait',wait:5},
 {type:'scroll',repeat:2,delayMs:1000},
 {type:'wait',wait:5},
 {type:'wait_for_selector',cssSelector:selector,timeout:15000,ignoreErrors:true},
 {type:'execute_js',code:inspect('post_loaded')},
 {type:'if',condition:`Boolean(document.querySelector(${JSON.stringify(selector)}))&&!(${visibleLogin})&&!location.pathname.startsWith('/login')`,then:[
  {type:'click',cssSelector:selector,timeout:15000,wait:2,ignoreErrors:true},
  {type:'wait_for_function',code:`[...document.images].some(i=>(i.currentSrc||i.src).includes(${JSON.stringify(target)})&&i.naturalWidth>590&&i.naturalHeight>503)`,timeout:15000,ignoreErrors:true}
 ]},
 {type:'execute_js',code:inspect('after_photo_click')}
]};
const start=Date.now();
const response=await fetch('https://publisher.scrappey.com/api/v1?key='+encodeURIComponent(process.env.SCRAPPEY_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(180000)});
const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{console.log('photo_browser_probe',JSON.stringify({http:response.status,json:false,elapsedSeconds:Math.round((Date.now()-start)/1000)}));process.exit(2);}
const solution=body.solution??{};
const states=(solution.javascriptReturn??[]).flat().filter(x=>x&&typeof x==='object'&&x.stage);
function imageSummary(i){try{const u=new URL(i.url);return {width:i.width,height:i.height,ctp:u.searchParams.get('ctp'),samePhoto:u.pathname.endsWith('/'+target)};}catch{return {invalidUrl:true};}}
const safeError=JSON.stringify(body.error??body.errors??'').toLowerCase();
console.log('photo_browser_probe',JSON.stringify({http:response.status,providerStatus:typeof body.data==='string'?body.data:null,targetStatus:solution.statusCode??null,path:solution.currentUrl?new URL(solution.currentUrl).pathname:null,elapsedSeconds:Math.round((Date.now()-start)/1000),errorKind:/timeout|timed out/.test(safeError)?'timeout':/selector/.test(safeError)?'selector':safeError==='""'?null:'provider_error',responseKeys:Object.keys(body),states:states.map(s=>({stage:s.stage,path:s.path,title:s.title,textLength:s.textLength,imageCount:s.imageCount,pageSignals:s.pageSignals,photoLinks:s.photoLinks,loginRequired:s.loginRequired,photoAnchors:s.photoAnchors,images:(s.images??[]).map(imageSummary)}))}));
const after=states.find(s=>s.stage==='after_photo_click');
if(!response.ok||!after){console.log('photo_browser_outcome provider_response_not_verified');process.exit(2);}
if(after.loginRequired||after.path.startsWith('/login')){console.log('photo_browser_outcome login_required');process.exit(2);}
const html=typeof solution.response==='string'?solution.response:'';
const observedUrls=new Set();
let entityEncodedUrls=0;
for(const match of html.matchAll(/"(https?:[^"\r\n]+)"/g)){if(!match[1].includes(target))continue;let value;try{value=JSON.parse('"'+match[1]+'"');}catch{value=match[1];}if(/&amp;|&#0*38;|&#x0*26;/i.test(value))entityEncodedUrls++;value=value.replace(/&amp;|&#0*38;|&#x0*26;/gi,'&');try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname.endsWith('.fbcdn.net')&&u.pathname.endsWith('/'+target))observedUrls.add(u.href);}catch{}}
const candidates=[...(after.images??[]),...[...observedUrls].map(url=>({url}))].filter(i=>{try{const u=new URL(i.url);return u.protocol==='https:'&&u.hostname.endsWith('.fbcdn.net')&&u.pathname.endsWith('/'+target);}catch{return false;}});
console.log('photo_browser_html',JSON.stringify({bytes:Buffer.byteLength(html),targetOccurrences:html.split(target).length-1,entityEncodedUrls,observedImageUrls:observedUrls.size,candidates:candidates.map(imageSummary)}));
const unique=[...new Map(candidates.map(i=>[i.url,i])).values()].slice(0,3);
let verified=false;
for(const image of unique){
const download=await fetch(image.url,{redirect:'error',signal:AbortSignal.timeout(20000)});
if(!download.ok){console.log('photo_browser_download',JSON.stringify({http:download.status}));continue;}
const chunks=[];let length=0;for await(const chunk of download.body){length+=chunk.length;if(length>6*1024*1024)throw Error('image_size_limit');chunks.push(Buffer.from(chunk));}
const bytes=Buffer.concat(chunks);let dimensions=null;
if(bytes[0]===255&&bytes[1]===216)for(let i=2;i+9<bytes.length;){if(bytes[i]!==255)break;const marker=bytes[i+1];if(marker===217||marker===218)break;const n=bytes.readUInt16BE(i+2);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){dimensions={width:bytes.readUInt16BE(i+7),height:bytes.readUInt16BE(i+5)};break;}if(n<2)break;i+=n+2;}
console.log('photo_browser_download',JSON.stringify({bytes:length,dimensions,sha256:createHash('sha256').update(bytes).digest('hex')}));
if(dimensions&&dimensions.width>590&&dimensions.height>503){verified=true;break;}
}
console.log('photo_browser_outcome '+(verified?'verified_larger_photo':'larger_photo_not_found'));
if(!verified)process.exitCode=2;
