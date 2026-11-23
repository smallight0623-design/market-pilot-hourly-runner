const response=await fetch('https://api.brightdata.com/datasets/v3/snapshot/sd_mwt7v8771o3tzg9dhi?format=json',{headers:{Authorization:'Bearer '+process.env.BRIGHTDATA_API_KEY},redirect:'error',signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error('snapshot_http_'+response.status);
const rows=await response.json();const row=rows.find(r=>String(r.url).includes('1690237639314591'));if(!row)throw Error('post_not_in_snapshot');
const host=url=>{try{const u=new URL(url);return {path:u.pathname,ctp:u.searchParams.get('ctp'),stp:u.searchParams.get('stp')};}catch{return null;}};
console.log(JSON.stringify({keys:Object.keys(row),attachments:row.attachments.map(a=>({keys:Object.keys(a),type:a.type,urls:Object.fromEntries(Object.entries(a).filter(([k,v])=>typeof v==='string'&&v.startsWith('https:')).map(([k,v])=>[k,host(v)]))}))}));

const {downloadBundle}=await import('./bootstrap.mjs');
await downloadBundle({...process.env,APPROVED_PACKAGE_SHA:'485126c36735f5e1e8e8b2d4813daca994c4a836aeebdc4c0e8327d97c8f44df'},{output:'quality-reader.mjs'});
const {createFacebookImageReader}=await import('./quality-reader.mjs');
const {chromium}=await import('playwright');
const reader=createFacebookImageReader({browserFactory:()=>chromium.launch({channel:'chrome',headless:true})});
try {
 const source=row.attachments[0].downloadable_url;
 const result=await reader.resolve({url:row.url},source);
 console.log(JSON.stringify({status:result.status,width:result.width,height:result.height,ctp:new URL(result.url).searchParams.get('ctp')}));
 if(result.status!=='photo_viewer_larger')throw Error('larger_image_not_verified');
} finally { await reader.close(); }
