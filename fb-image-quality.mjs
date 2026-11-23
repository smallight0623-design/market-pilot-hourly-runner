const source='https://www.facebook.com/photo?fbid=2228186758134890&set=gm.1690237639314591&idorvanity=331505628521139';
const request={cmd:'request.get',url:source,proxyCountry:'Taiwan',browserActions:[{type:'execute_js',code:'(() => [...document.images].filter(i => (i.currentSrc||i.src).includes("927091456_2228186761468223")).map(i => ({url:i.currentSrc||i.src,width:i.naturalWidth,height:i.naturalHeight})))()'}]};
const r=await fetch('https://publisher.scrappey.com/api/v1?key='+encodeURIComponent(process.env.SCRAPPEY_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(180000)});
if(!r.ok)throw Error('provider_http_'+r.status);
const body=await r.json(),s=body.solution;
console.log(JSON.stringify({provider:body.data,error:body.error??null,status:s?.statusCode,path:s?.currentUrl?new URL(s.currentUrl).pathname:null,images:s?.javascriptReturn?.map(x=>Array.isArray(x)?x.map(i=>({width:i.width,height:i.height,ctp:i.url?new URL(i.url).searchParams.get('ctp'):null})):x)}));
const images=(s?.javascriptReturn??[]).flat().filter(x=>x?.width>590&&x?.height>503);
if(s?.statusCode!==200||!images.length)throw Error('larger_photo_not_verified');
