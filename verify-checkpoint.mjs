import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export async function verifyBundle(file,expected){
 if(!expected||!/^[a-f0-9]{64}$/.test(expected.sha256)||!Number.isSafeInteger(expected.bytes)||expected.bytes<1||expected.bytes>96*1024*1024)throw Error('invalid_checkpoint');
 const info=await stat(file);if(!info.isFile()||info.size!==expected.bytes)throw Error('bundle_size_mismatch');
 const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
 if(digest.digest('hex')!==expected.sha256)throw Error('bundle_sha_mismatch');
 return {verified:true,sha256:expected.sha256,bytes:expected.bytes,productionChanged:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [manifest,role,file]=process.argv.slice(2);if(!manifest||!file||!['formal','testedCandidate'].includes(role))throw Error('usage: manifest.json formal|testedCandidate bundle.zip');
 const registry=JSON.parse(await readFile(manifest,'utf8'));if(registry.version!==1)throw Error('unsupported_checkpoint');
 console.log(JSON.stringify(await verifyBundle(file,registry[role])));
}
