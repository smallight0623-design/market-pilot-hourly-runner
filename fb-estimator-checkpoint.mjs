import {createHash} from 'node:crypto';

export const stateKey = 'facebook-feed-v1/state.json';
const format = 'fb-delta-v1';
const limit = 32 * 1024 * 1024;
const tables = new Set(['posts','jobs','fbQueue','feedReceipts','fbAnalyses']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));
const baseKey = hash => 'facebook-feed-v1/bases-v1/' + hash + '.json';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function check(state) {
  if (state?.version !== 1 || ![state.jobs,state.months,state.posts].every(record)) throw Error('fb_state_invalid');
}

function changes(before, after) {
  const removed = Object.keys(before).filter(key => !Object.hasOwn(after,key));
  const added = Object.entries(after).filter(([key,value]) =>
    !Object.hasOwn(before,key) || JSON.stringify(value) !== JSON.stringify(before[key]));
  const natural = Object.keys(Object.fromEntries([
    ...Object.entries(before).filter(([key]) => Object.hasOwn(after,key)), ...added
  ]));
  const keys = Object.keys(after);
  const order = natural.some((key,index) => keys[index] !== key) ? keys : undefined;
  return {removed, added, order};
}

function apply(before, patch) {
  const entries = new Map(Object.entries(before));
  for (const key of patch.removed) entries.delete(key);
  for (const [key,value] of patch.added) entries.set(key,value);
  if (!patch.order) return Object.fromEntries(entries);
  if (patch.order.length !== entries.size || new Set(patch.order).size !== entries.size ||
      patch.order.some(key => !entries.has(key))) throw Error('fb_delta_order');
  return Object.fromEntries(patch.order.map(key => [key,entries.get(key)]));
}

const metadata = state => Object.fromEntries(Object.entries(state).map(([key,value]) =>
  [key, tables.has(key) && record(value) ? null : value]));

export function prepareBase(bytes) {
  if (bytes.length > limit) throw Error('fb_state_limit');
  const state = JSON.parse(bytes);
  check(state);
  const hash = digest(bytes);
  return {state,hash,key:baseKey(hash)};
}

export function encodeCheckpoint(base,state) {
  check(state);
  const bytes = encode(state);
  if (bytes.length > limit) throw Error('fb_state_limit');
  const rows = {};
  for (const key of tables) if (record(state[key])) rows[key] = changes(base.state[key] ?? {},state[key]);
  return encode({format,base:base.hash,hash:digest(bytes),meta:changes(metadata(base.state),metadata(state)),rows});
}

export async function decodeCheckpoint(bytes,getBase) {
  if (bytes.length > limit) throw Error('fb_state_limit');
  const pointer = JSON.parse(bytes);
  if (pointer?.format !== format) { check(pointer); return pointer; }
  if (!/^[0-9a-f]{64}$/.test(pointer.base)) throw Error('fb_delta_base');
  const source = await getBase(baseKey(pointer.base));
  if (!source || source.length > limit || digest(source) !== pointer.base) throw Error('fb_delta_integrity');
  const original = JSON.parse(source);
  check(original);
  const state = apply(metadata(original),pointer.meta);
  for (const [key,patch] of Object.entries(pointer.rows)) {
    if (!tables.has(key) || !Object.hasOwn(state,key)) throw Error('fb_delta_table');
    state[key] = apply(original[key] ?? {},patch);
  }
  check(state);
  if (digest(encode(state)) !== pointer.hash) throw Error('fb_delta_integrity');
  return state;
}
