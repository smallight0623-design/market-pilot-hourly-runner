import {S3Client, GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {downloadBundle} from './bootstrap.mjs';
const env = process.env;
const sha = 'bf9ff02d6ed3603726dacf32674bccfe467d2eb643509ba16b8e9a660f90a35d';
await downloadBundle({...env,APPROVED_PACKAGE_SHA:sha},{output:'fb-verified-decoder.mjs'});
const {prepareBase,encodeCheckpoint,decodeCheckpoint,stateKey} = await import('./fb-verified-decoder.mjs');
const sdk = new S3Client({endpoint:env.R2_ENDPOINT,region:'auto',forcePathStyle:true,maxAttempts:1,
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
const object = key => ({Bucket:'market-pilot-state-trial',Key:'i015-trial/hourly-live-v1/'+key});
async function get(key) {
  const response = await sdk.send(new GetObjectCommand(object(key)));
  if (!response.ETag || !Number.isSafeInteger(response.ContentLength) || response.ContentLength>32*1024*1024) throw Error('invalid_object');
  return {etag:response.ETag,bytes:Buffer.from(await response.Body.transformToByteArray())};
}
const readBase = async key => (await get(key)).bytes;
try {
  const old = await get(stateKey);
  const state = await decodeCheckpoint(old.bytes,readBase);
  if (state.lease) throw Error('active_lease');
  if (JSON.parse(old.bytes).format==='fb-delta-v1') {
    console.log(JSON.stringify({status:'already_active_verified',bytes:old.bytes.length}));
  } else {
    const bytes=Buffer.from(JSON.stringify(state));
    const base=prepareBase(bytes);
    try {
      await sdk.send(new PutObjectCommand({...object(base.key),Body:bytes,IfNoneMatch:'*',ContentType:'application/json'}));
    } catch(error) {
      if(error.$metadata?.httpStatusCode!==412) throw error;
    }
    const delta=encodeCheckpoint(base,state);
    const expected=JSON.stringify(state);
    if(JSON.stringify(await decodeCheckpoint(delta,readBase))!==expected) throw Error('base_readback_mismatch');
    const result=await sdk.send(new PutObjectCommand({...object(stateKey),Body:delta,IfMatch:old.etag,ContentType:'application/json'}));
    const saved=await get(stateKey);
    if(saved.etag!==result.ETag || JSON.stringify(await decodeCheckpoint(saved.bytes,readBase))!==expected)throw Error('readback_mismatch');
    console.log(JSON.stringify({status:'active_verified',oldBytes:old.bytes.length,newBytes:saved.bytes.length}));
  }
} finally { sdk.destroy(); }
