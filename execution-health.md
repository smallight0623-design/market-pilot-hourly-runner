# Independent execution health

`hourly-push.yml` has a parallel `execution_health` job. It runs entirely from this repository and does not download or execute the private application. `execution-health-observe.yml` also runs after the hourly workflow completes, including cancellation, to finalize its receipt. Manual observation of an existing run is read-only except for the small health receipts; it does not rerun collection.

The reporter polls GitHub jobs once a minute and writes only the fixed R2 keys `i015-trial/hourly-live-v1/execution-health-v1/8591.json` and `facebook.json`, each limited to 8 KiB. Conditional writes preserve newer runs and completed results. Existing R2 and ephemeral workflow credentials are used. No source requests, AI calls, Discord messages, application logs or inventory reads occur.

Run tests with `node --test execution-health.test.mjs`. The isolated `execution-health-probe.yml` intentionally fails a dummy `hourly` job before business work. Its health job must succeed and write `probe-8591.json` with `failedStage: rules`, `conclusion: failure`. The overall probe workflow is expected to be red; do not mistake it for a collector outage. Verified live probe: 45648177430.

The private core console reads these through its authenticated `/api/execution-health` endpoint. A successful GitHub job is not proof that every product was delivered; the UI keeps business results separate. No new observation beyond 90 minutes is displayed as overdue. Missing or corrupt receipts remain unconfirmed, never healthy.

Rollback the console and these workflow changes together if necessary. Do not alter business snapshots, pending payment/delivery intents, or application package pins to revert this reporting feature. If changing job names, update reporter targets and tests together.
