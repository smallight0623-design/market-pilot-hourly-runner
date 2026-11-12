# Recognition recovery checkpoint

The JSON file pins immutable application bundle hashes. Application source, models, images, inventories, private fixtures and secrets remain outside this public repository. The tested candidate is preserved separately from the formal bundle and is not deployment approval.

Git restores this execution wrapper and version registry; it does not itself restore the private application. Fetch the selected immutable bundle using the existing authenticated private bootstrap, verify its SHA-256 and internal file manifest, and run matching application/Linux acceptance checks before changing an approved release pointer.

Local hash check (does not upload, deploy, extract or modify files):

```
node verify-checkpoint.mjs checkpoints/recognition-20261112.json formal /path/to/private-bundle.zip
```

Use `testedCandidate` to verify the preserved offline candidate instead. The candidate opt-in is `SELECTIVE_LOCAL_ANALYSIS=v1`; leaving it unset preserves the AI baseline. A code rollback must preserve current business state, catalog/pricing configuration, source records, model-usage records and confirmed delivery receipts. Never restore an old state snapshot or replay deliveries as part of reverting code. Check current live state and active publisher leases before any release operation.

Pushing this registry or creating a tag does not change the approved package, restart tracking or enable the candidate. This repository has no push-triggered workflow.
