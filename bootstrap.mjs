import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function bundleConfig(env){
 const endpoint=new URL(env.R2_ENDPOINT);
 if(endpoint.protocol!=='https:'||!/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||endpoint.port)throw Error('invalid_endpoint');
 if(!/^[a-f0-9]{64}$/.test(env.APPROVED_PACKAGE_SHA??'')||!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY)throw Error('missing_bundle_configuration');
 return {endpoint:endpoint.origin,bucket:'market-pilot-state-trial',key:'i015-trial/hourly-live-v1/blobs/'+env.APPROVED_PACKAGE_SHA+'.blob',sha:env.APPROVED_PACKAGE_SHA};
}
export async function downloadBundle(env,{getObject,output='hourly-package.zip'}={}){
 const config=bundleConfig(env);let client;
 try{
  if(!getObject){const {S3Client,GetObjectCommand}=await import('@aws-sdk/client-s3');client=new S3Client({endpoint:config.endpoint,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestHandler:{requestTimeout:20000,connectionTimeout:10000}});getObject=()=>client.send(new GetObjectCommand({Bucket:config.bucket,Key:config.key}));}
  const result=await getObject(config);if(result.ContentLength>8*1024*1024)throw Error('bundle_too_large');
  const chunks=[];let length=0;for await(const b of result.Body){length+=b.length;if(length>8*1024*1024)throw Error('bundle_too_large');chunks.push(Buffer.from(b));}
  const bytes=Buffer.concat(chunks);if(crypto.createHash('sha256').update(bytes).digest('hex')!==config.sha)throw Error('bundle_checksum_failed');
  await fs.writeFile(output,bytes,{flag:'wx'});return {bytes:bytes.length};
 }finally{client?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)downloadBundle(process.env).then(()=>console.log('Approved private bundle verified.')).catch(()=>{console.error('Private bundle unavailable or checksum failed; stopped.');process.exitCode=1;});
