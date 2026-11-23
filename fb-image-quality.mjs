// One-record public-post probe; never changes the production feed or sends cards.
const headers={Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`,'Content-Type':'application/json'};
async function request(path,options={}){const r=await fetch('https://api.brightdata.com/datasets/v3/'+path,{...options,headers,signal:AbortSignal.timeout(65000)});if(!r.ok)throw Error('brightdata_http_'+r.status);return r.json();}
let result=await request('scrape?dataset_id=gd_lyclm1571iy3mv57zw&format=json',{method:'POST',body:JSON.stringify([{url:'https://www.facebook.com/groups/331505628521139/posts/1690237639314591/'}])});
if(result.snapshot_id){const id=result.snapshot_id;console.log('probe_snapshot',id);for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,10000));const p=await request('progress/'+id);console.log('probe_progress',p.status);if(p.status==='ready'){result=await request('snapshot/'+id+'?format=json');break;}if(p.status==='failed')throw Error('collection_failed');}}
if(!Array.isArray(result))throw Error('probe_pending');
function summary(v){try{const u=new URL(v);return {path:u.pathname,ctp:u.searchParams.get('ctp')};}catch{return null;}}
for(const row of result){console.log('probe_result',JSON.stringify({error:row.error_code??null,fields:Object.keys(row),postImage:summary(row.post_image),attachments:row.attachments?.map(x=>({type:x.type,url:summary(x.url),download:summary(x.downloadable_url)}))}));}
