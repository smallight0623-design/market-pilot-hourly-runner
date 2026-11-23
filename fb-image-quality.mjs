// Read-only provider catalogue; emit compact metadata lines only.
const r=await fetch('https://api.brightdata.com/datasets/v3/scrapers?domain=facebook.com',{headers:{Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`},signal:AbortSignal.timeout(45000)});
if(!r.ok)throw Error('catalog_http_'+r.status);
const data=await r.json();
for(const item of data){console.log('scraper',JSON.stringify({id:item.id??item.dataset_id,name:item.name,keys:Object.keys(item)}));for(const [key,val] of Object.entries(item)){if(/input|variant|method|schema/i.test(key))console.log('schema',JSON.stringify({id:item.id??item.dataset_id,key,value:val}).slice(0,3500));}}
