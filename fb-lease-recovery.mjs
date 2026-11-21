export async function recoverExpiredLease({state, now, currentRunId, lookup, save}) {
  const lease = state.lease;
  if (!lease) return 'unlocked';
  if (!Number.isFinite(lease.expiresAt)) throw Error('fb_invalid_lease_expiry');
  if (now < lease.expiresAt) return 'active';
  const id = /^fb-([1-9][0-9]*)$/.exec(lease.runId)?.[1];
  if (!id || id === currentRunId) throw Error('fb_previous_run_identity_unknown');
  const run = await lookup(id);
  if (String(run.id) !== id || run.repository?.full_name !== 'smallight0623-design/market-pilot-hourly-runner'
      || run.path !== '.github/workflows/hourly-push.yml' || run.event !== 'workflow_dispatch'
      || run.head_branch !== 'main') throw Error('fb_previous_run_identity_unknown');
  if (run.status !== 'completed' || !run.conclusion) return 'previous_run_not_terminal';
  // Collection reservations, analysis intents and Discord receipts remain authoritative.
  // The normal runner will inspect them and separately acquire its own lease.
  await save({...state,lease:null,lastLeaseRecovery:{
    previousRunId:lease.runId, recoveredBy:'fb-'+currentRunId,
    recoveredAt:new Date(now).toISOString(), conclusion:run.conclusion
  }});
  return 'released_terminal_run';
}
