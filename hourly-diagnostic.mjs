// Only display bounded, machine-generated health fields; never print private logs.
import fs from'node:fs/promises';
try{const text=await fs.readFile(process.env.GITHUB_STEP_SUMMARY,'utf8');const blocks=[...text.matchAll(/```json\s*([\s\S]*?)```/g)];const s=JSON.parse(blocks.at(-1)?.[1]??'null');if(!s)throw Error('absent');
 const word=v=>typeof v==='string'&&/^[a-z0-9_]{1,90}$/.test(v)?v:null;const n=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 const c=s.storage?.snapshotCapacity;if(['warning','critical'].includes(c?.status))console.log('::warning title=Snapshot capacity::Logical state is approaching its process memory guard; inspect the bounded hourly health summary before further growth.');console.log(JSON.stringify({event:'hourly_health',status:word(s.status),failure:s.firstFailure?{stage:word(s.firstFailure.stage),code:word(s.firstFailure.code)}:null,capacity:c?{status:word(c.status),encoding:c.encoding==='segmented-v1'?'segmented-v1':'legacy',rootBytes:n(c.rootBytes),logicalBytes:n(c.logicalBytes),segments:n(c.segments),changedSegments:n(c.changedSegments)}:null}));
}catch{console.log(JSON.stringify({event:'hourly_health',status:'diagnostic_unavailable'}));}
