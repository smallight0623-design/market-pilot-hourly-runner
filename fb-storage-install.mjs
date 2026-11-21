import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {downloadBundle} from './bootstrap.mjs';

const sha = 'ee6bd9a0096a6518ee56ff221d8153e610aa9afd77aeb887c5677477d3a79a8a';
const original = await readFile('app/facebook/cloud-entry.mjs','utf8');
const digest = createHash('sha256').update(original.replaceAll('\r\n','\n')).digest('hex');
if (digest !== '1f1865ed2b6b5afce0dde07f2849de99eb92d666da56ce2e3a09918cf3f55249') throw Error('fb_storage_entry_requires_rebuild');
await downloadBundle({...process.env, APPROVED_PACKAGE_SHA:sha},{output:'app/facebook/checkpoint-entry.mjs'});
