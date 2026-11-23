// Read-only provider catalogue. No collection is triggered.
const headers={Authorization:`Bearer ${process.env.BRIGHTDATA_API_KEY}`};
for(const domain of ['facebook.com','www.facebook.com']){
 const r=await fetch('https://api.brightdata.com/datasets/v3/scrapers?domain='+domain,{headers,signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('catalog_http_'+r.status);
 const data=await r.json();
 console.log('catalog_type',JSON.stringify({domain,array:Array.isArray(data),keys:Object.keys(data).slice(0,20)}));
 console.log('catalog_metadata',JSON.stringify(data).slice(0,90000));
}
