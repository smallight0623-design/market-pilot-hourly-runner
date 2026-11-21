import test from 'node:test';
import assert from 'node:assert/strict';
import {updateIndexHealth} from './index-health.mjs';
test('failure streak resets on success and old completions cannot supersede newer starts',async()=>{
  let previous;
  const store={read:async()=>previous,write:async(value,etag)=>{assert.equal(etag,previous?.etag);previous={value,etag:'test'};}};
  for(const [start,ok,want] of [[1,false,1],[2,false,2],[3,true,0],[1,false,0]]){
    await updateIndexHealth(store,{startedAt:start,finishedAt:4,ok});
    assert.equal(previous.value.consecutiveFailures,want);
  }
});
