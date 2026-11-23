// Read-only diagnosis: reuse a paid snapshot and inspect the official catalogue.
const headers={Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`};
async function get(path){const r=await fetch('https://api.brightdata.com/datasets/v3/'+path,{headers,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('brightdata_http_'+r.status);return r.json();}
function summary(v){if(typeof v!=='string')return {type:typeof v};try{const u=new URL(v);return {host:u.hostname,path:u.pathname,ctp:u.searchParams.get('ctp'),stp:u.searchParams.get('stp')};}catch{return {type:'text',length:v.length};}}
const rows=await get('snapshot/sd_mwt7v8771o3tzg9dhi?format=json');
const row=rows.find(x=>JSON.stringify(x).includes('1690237639314591'));
if(!row)throw Error('target_not_found');
console.log('saved_image_fields',JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k])=>/image|photo/.test(k)).map(([k,v])=>[k,Array.isArray(v)?v.map(summary):summary(v)]))));
console.log('saved_attachments',JSON.stringify(row.attachments?.map(x=>({id:x.id,type:x.type,url:summary(x.url),download:summary(x.downloadable_url)}))));
for(const domain of ['facebook.com','www.facebook.com']){const catalog=await get('scrapers?domain='+domain);console.log('official_catalog',JSON.stringify(catalog));}
