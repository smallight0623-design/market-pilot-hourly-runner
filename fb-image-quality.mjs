const response=await fetch('https://api.brightdata.com/datasets/v3/snapshot/sd_mwt7v8771o3tzg9dhi?format=json',{headers:{Authorization:'Bearer '+process.env.BRIGHTDATA_API_KEY},redirect:'error',signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error('snapshot_http_'+response.status);
const rows=await response.json();const row=rows.find(r=>String(r.url).includes('1690237639314591'));if(!row)throw Error('post_not_in_snapshot');
const host=url=>{try{const u=new URL(url);return {path:u.pathname,ctp:u.searchParams.get('ctp'),stp:u.searchParams.get('stp')};}catch{return null;}};
console.log(JSON.stringify({keys:Object.keys(row),attachments:row.attachments.map(a=>({keys:Object.keys(a),type:a.type,urls:Object.fromEntries(Object.entries(a).filter(([k,v])=>typeof v==='string'&&v.startsWith('https:')).map(([k,v])=>[k,host(v)]))}))}));
