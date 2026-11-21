import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function snapshotRecords(snapshot,get){
 const records=snapshot?.data?.metadata?.hourly?.records;
 if(!records||Array.isArray(records))throw Error('search_records_missing');
 if(snapshot.snapshotEncoding===undefined){if(snapshot.data.schemaVersion===2)throw Error('search_segments_missing');return Object.values(records);}
 if(snapshot.snapshotEncoding!=='segmented-v1'||snapshot.data.schemaVersion!==2||!Array.isArray(snapshot.snapshotSegments)||snapshot.snapshotSegments.length>4096||Object.keys(records).length)throw Error('search_segment_manifest');
 const found=new Map(),seen=new Set();let total=0;
 for(const d of snapshot.snapshotSegments.filter(d=>d.table==='records')){
  if(!/^[a-f0-9]{1,64}$/.test(d.bucket)||!/^([a-f0-9]{64})$/.test(d.hash)||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>5*1024*1024||!Number.isSafeInteger(d.rawBytes)||d.rawBytes<1||d.rawBytes>16*1024*1024||!Number.isSafeInteger(d.count)||d.count<1||seen.has(d.bucket)||(total+=d.rawBytes)>256*1024*1024)throw Error('search_record_segment');
  seen.add(d.bucket);const value=await get('blobs/'+d.hash+'.blob'),bytes=value.bytes;if(bytes.length!==d.bytes||sha(bytes)!==d.hash)throw Error('search_record_checksum');
  const raw=gunzipSync(bytes,{maxOutputLength:d.rawBytes});if(raw.length!==d.rawBytes)throw Error('search_record_size');const rows=JSON.parse(raw);if(!rows||Array.isArray(rows)||Object.keys(rows).length!==d.count)throw Error('search_record_count');
  for(const[id,row]of Object.entries(rows)){if(['__proto__','constructor','prototype'].includes(id)||!sha(id).startsWith(d.bucket)||found.has(id)||row?.id!==id)throw Error('search_record_identity');found.set(id,row);}
 }
 return [...found.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,r])=>r);
}
