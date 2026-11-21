import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverExpiredLease} from './fb-lease-recovery.mjs';
const state={lease:{runId:'fb-123',expiresAt:100},jobs:{j:{status:'unknown'}},fbAnalyses:{p:{status:'starting'}},feedReceipts:{p:{status:'unknown'},q:{status:'sent'}},months:{used:100}};
const run={id:123,path:'.github/workflows/hourly-push.yml',repository:{full_name:'smallight0623-design/market-pilot-hourly-runner'},event:'workflow_dispatch',head_branch:'main',status:'completed',conclusion:'cancelled'};
const base={state,currentRunId:'124',now:101,lookup:async()=>run,save:()=>assert.fail('unexpected write')};
test('cancelled run unlocks without modifying paid or delivery ledgers',async()=>{
  let saved;
  assert.equal(await recoverExpiredLease({...base,save:v=>{saved=v}}),'released_terminal_run');
  assert.equal(saved.lease,null);
  const {lastLeaseRecovery,lease,...retained}=saved;
  assert.deepEqual(retained,(( {lease,...rest})=>rest)(state));
  assert.equal(lastLeaseRecovery.previousRunId,'fb-123');
});
test('active, ambiguous or mismatched owners cannot release a lease',async()=>{
  assert.equal(await recoverExpiredLease({...base,now:99,lookup:()=>assert.fail()}),'active');
  assert.equal(await recoverExpiredLease({...base,lookup:async()=>({...run,status:'in_progress'})}),'previous_run_not_terminal');
  await assert.rejects(recoverExpiredLease({...base,lookup:async()=>({...run,id:22})}),/identity/);
  await assert.rejects(recoverExpiredLease({...base,save:async()=>{throw Error('etag_conflict')}}),/etag_conflict/);
});
