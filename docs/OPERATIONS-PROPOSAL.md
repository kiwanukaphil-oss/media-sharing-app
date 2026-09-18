# Production operations proposal

Prepared 2026-09-17. Recommendations only: no service signup, payment, notification test, backup transfer or credential changes were performed.

Update 2026-09-18: the user approved this setup and supplied the alert email. See [activation status](OPERATIONS-ACTIVATION.md); approval does not mean the external services are already active.

## Recommended setup

Use Better Stack for external uptime and backup-job monitoring, email as the initial alert channel, and a separate Backblaze B2 account/bucket for independent copies of originals and database exports. Keep the existing GitHub health workflow as an additional check. Proposed operating allowance: USD 10/month for these new operational services, excluding existing Cloudflare hosting, taxes and any paid backup runner. This is a planning allowance, not an enforced spending cap.

### Alerts

Monitor the public home page and `/api/health` every three minutes. Require a successful HTTP response and the expected health result. Alert the designated owner email on confirmed failure and recovery. Use a daily heartbeat for the backup job, with a grace period; report success only after the database export, object-copy verification and manifest publication finish. A proposed 03:00 Africa/Nairobi daily backup with a two-hour grace period gives a concrete starting schedule.

Better Stack advertises three-minute checks on its free offering, and its pricing page lists email/Slack alerts on the free personal-project tier. Confirm account eligibility before relying on a zero-cost plan; if Relay requires a paid tier, obtain its actual quote before activation. Do not enable session replay or collect private app content for basic uptime monitoring. Sources: [Uptime](https://betterstack.com/uptime), [pricing](https://betterstack.com/pricing).

The existing GitHub workflow runs every 30 minutes. Only a successful manually dispatched run was visible during this review; scheduled execution and delivery have not been proven. GitHub scheduled-workflow notifications follow the workflow creator/cron editor/re-enabler, so they are not a configurable team alert destination by themselves. Source: [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

### Backups and recovery

- Back up completed originals, including Trash, plus a matching D1 export and object manifest. Thumbnails are regenerable; credentials, private metadata and exports must remain private and encrypted.
- Use an incremental, version-preserving process: retain unchanged originals once, retain daily recovery manifests/database snapshots for 30 days, and retain deleted originals while any retained recovery manifest references them. Never mirror live deletions immediately into the backup.
- Separate source read credentials and destination backup-write credentials from Relay's runtime. Keep recovery keys outside the app and backup runner. A separately controlled retention job handles pruning; the regular copy job must not be able to purge recovery history.
- Aim for a 24-hour recovery point after a successful daily job. Files uploaded and permanently deleted between backups may never be captured; eliminating that window requires an upload-time backup or a deletion grace period, which is additional product scope.
- Record export timestamps and validate that each ready object referenced in the recovery snapshot has a verified backup copy. Concurrent permanent deletion can create a mismatch: fail the job/heartbeat rather than claim a complete recovery point.
- Test restoration into isolated storage, comparing original SHA-256 values and database relationships. Set a recovery-time target only after timing that test. Restoring device records can revive old access, so recovery must include an explicit session-revocation/re-pairing procedure.
- Consider 30-day governance Object Lock as added protection after testing retention and pruning. Object Lock duration starts from the object version's retention setting, not automatically from source deletion; extend protection where needed for retained snapshots. Do not enable non-overridable compliance retention by default. [Backblaze Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).

### Estimated storage cost

Backblaze publishes USD 6.95/TB/month, with the first 10 GB free. Estimates below use decimal billing GB, full-month average retained bytes, and no taxes. Retained bytes include deletion history, not just the current library. [Backblaze pricing](https://www.backblaze.com/cloud-storage/pricing).

| Average retained backup size | Estimated B2 storage/month |
| --- | ---: |
| 100 GiB (about 107.4 GB) | $0.68 |
| 200 GiB (about 214.7 GB) | $1.42 |
| 1 TB (1,000 GB) | $6.88 |

Thirty daily manifests do not require thirty full copies of unchanged media. Heavy upload/deletion churn increases retained storage. Backup execution, requests outside allowances and unusual restore traffic can add costs. B2 includes download allowance up to three times average stored data; excess generally costs $0.01/GB. Direct R2 outbound transfer is free, but source read/list operations remain metered. [B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Alternatives

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| Better Stack + B2 (recommended) | External health/backup checks and a second storage provider | Two operational accounts; email and budget approval needed |
| Existing GitHub checks + B2 | One fewer monitoring service | Thirty-minute schedule, possible delays, notification ownership is less explicit |
| Second-account R2 backup | Familiar storage tooling and separate credentials | Same provider; standard storage is $0.015/GB-month before free allowance/operations |

## Decisions before activation

Confirm the recommended providers, alert email, USD 10/month starting allowance and 30-day retention. Choose the backup region during account setup. Verify any free-tier eligibility and runner costs, then run a controlled alert-delivery test and an isolated restore test before calling operations ready. No paid subscription, backup copy, or outgoing alert is authorized by this proposal alone.
