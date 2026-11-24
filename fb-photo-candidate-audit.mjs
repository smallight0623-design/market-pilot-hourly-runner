// Read-only audit of already paid source records; no collection requests.
const r=await fetch('https://api.brightdata.com/datasets/v3/snapshot/sd_mwt7v8771o3tzg9dhi?format=json',{headers:{Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`},signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error('source_http_'+r.status);
const rows=await r.json();
for(const row of rows){const a=(row.attachments??[]).filter(x=>/photo|image/i.test(x.type??''));if(!a.length)continue;console.log('photo_sample',JSON.stringify({url:row.url,date:row.date_posted,photos:a.length,attachments:a.slice(0,3).map(x=>{let u;try{u=new URL(x.downloadable_url??x.url);}catch{}return {id:x.id,path:u?.pathname,ctp:u?.searchParams.get('ctp')};})}));}
console.log('photo_sample_total',rows.length);
