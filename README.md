# Hourly runner

Public execution wrapper for an owner-operated market monitor. The workflow accepts authenticated hourly dispatches only. It has no push, pull-request, or built-in schedule trigger.

The approved application bundle and configuration remain in private object storage. The bootstrap verifies its SHA-256 before extraction. Credentials are supplied through repository Secrets only during the steps that need them. There is no artifact upload; application logs are kept in temporary runner files, and the public summary contains counts only.

This repository does not include account inventories, pricing rules, source images, private notes, or application source. A successful workflow is not evidence of a sale or guaranteed extraction accuracy.

Required repository variables and Secrets are configured by the owner during deployment. No example credentials or public storage URLs are included. Run only on standard GitHub-hosted Ubuntu runners; never enable untrusted pull-request execution with Secrets.
