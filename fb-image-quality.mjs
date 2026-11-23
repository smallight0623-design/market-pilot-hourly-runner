// One public photo URL probe. Production collection and card delivery remain unchanged.
const headers={Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`,'Content-Type':'application/json'};
async function request(path,options={}){const r=await fetch('https://api.brightdata.com/datasets/v3/'+path,{...options,headers,signal:AbortSignal.timeout(65000)});if(!r.ok)throw Error('brightdata_http_'+r.status);return r.json();}
const catalog=await request('scrapers?dataset_id=gd_lyclm1571iy3mv57zw');
for(const x of catalog)for(const [method,s] of Object.entries(x.scrapers??{}))console.log('detail_schema',JSON.stringify({method,s}).slice(0,5000));
const source='https://www.facebook.com/photo?fbid=2228186758134890&set=gm.1690237639314591&idorvanity=331505628521139';
let result=await request('scrape?dataset_id=gd_lyclm1571iy3mv57zw&format=json&include_errors=true',{method:'POST',body:JSON.stringify([{url:source}])});
if(result.snapshot_id){const id=result.snapshot_id;console.log('photo_snapshot',id);for(let n=0;n<8;n++){await new Promise(r=>setTimeout(r,10000));const p=await request('progress/'+id);console.log('photo_progress',p.status);if(p.status==='ready'){result=await request('snapshot/'+id+'?format=json');break;}if(p.status==='failed')throw Error('collection_failed');}}
if(!Array.isArray(result))throw Error('photo_probe_pending');
const urls=new Set();function inspect(v){if(typeof v==='string'&&v.includes('927091456_2228186761468223')){try{const u=new URL(v);if(u.protocol==='https:'&&u.hostname.endsWith('.fbcdn.net'))urls.add(u.href);}catch{}}else if(v&&typeof v==='object')Object.values(v).forEach(inspect);}
for(const row of result){console.log('photo_result',JSON.stringify({errorCode:row.error_code??null,error:row.error??null,fields:Object.keys(row)}));inspect(row);}
function jpeg(b){if(b[0]!==255||b[1]!==216)return null;for(let i=2;i+9<b.length;){if(b[i]!==255)break;const m=b[i+1];if(m===217||m===218)break;const n=b.readUInt16BE(i+2);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(m))return {width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};if(n<2)break;i+=n+2;}return null;}
for(const u of [...urls].slice(0,3)){const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok){console.log('photo_download',r.status);continue;}const b=Buffer.from(await r.arrayBuffer());console.log('photo_dimensions',JSON.stringify({...jpeg(b),bytes:b.length,ctp:new URL(u).searchParams.get('ctp')}));}
console.log('photo_probe_complete',JSON.stringify({matchingUrls:urls.size}));
