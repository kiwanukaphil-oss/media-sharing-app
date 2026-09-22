# Independent scheduled identity monitor

Status: activated on 21 September 2026 at 15:03 UTC following explicit user approval. Dedicated Worker `relay-identity-monitor` runs at minutes 19 and 49 UTC, without a preview URL or workers.dev endpoint. Initial version `7c5a2bcd-ae1a-47b8-bd0c-8f0cb859a7e2` passed its first actual cron at 15:19 UTC, including signed health delivery. Current leaner version: `49576315-efae-4b4d-b815-29532e4aac8d` (see below). All four required secret names were read back after encrypted installation. **Free-plan CPU headroom remains a release concern; external test-alert Inbox receipt was verified on 22 September.**

## Reason for the change

GitHub's twice-hourly combined monitor did not dispatch on schedule. At approximately 11:54 UTC the latest successful check was from 09:05; Relay correctly returned HTTP 503 for stale evidence. Manual run 35596479265 passed and restored HTTP 200. GitHub [documents delayed or dropped scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Do not weaken the freshness check to conceal missed executions.

Use a dedicated [Cloudflare Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) at minutes 19 and 49 UTC as an independent execution path. GitHub remains a separate diagnostic/redundant runner. Better Stack continues checking the existing aggregate health endpoint; neither runner can report success without completing both checks. Hosted cron execution and alert receipt are now verified as recorded below.

## Exact access and data boundaries

- Reuse the existing dedicated Auth0 monitor client `1Rakur48pyVj6WOVy3Yyb4cY31E0IEpb`, retaining exactly `read:users` and `read:logs`. No web-login secret, password-reset authority or broader provider grant.
- Reuse the existing read-only D1 API token. This deliberately uses the API instead of a native D1 binding, because a binding would introduce database-write authority. Only two fixed SELECT statements are permitted; results must attest zero writes.
- Reuse the aggregate health-report HMAC secret. It updates operational health only; it cannot reset passwords, revoke accounts or access media.
- Report through a service binding to Relay. No public trigger, input-controlled URL/query, R2 binding, media data or deletion permission is present.
- Provider/identity logic is shared with the tested GitHub scripts. Logs contain static aggregate outcomes only. Each response is bounded to 128 KiB, each request to 15 seconds, and the combined read phase to 60 seconds.
- The pilot guard fails closed above 40 active identities, leaving room under the [Free Workers 50-subrequest limit](https://developers.cloudflare.com/workers/platform/limits/#subrequests). This is not proof of CPU capacity at 40 identities; review hosted usage and capacity before expansion. No paid plan change is made.

The browser requires approval before copying the existing provider secret into an additional service. The prepared local installer uses a single-use, same-origin loopback form, Windows-encrypted local storage and Wrangler stdin. It never puts a credential in a URL, plaintext file, command argument, Git or console output.

## Checklist

- [x] Extract shared provider/identity/report logic without changing the GitHub entry points; existing provider, actual-schema identity and R2 report tests pass.
- [x] Add scheduled Worker, generated binding types, disabled config and bounded failure handling.
- [x] Verify healthy/unhealthy checks, capacity limits, database/provider failures, report rejection, signatures and absence of a public trigger.
- [x] Exercise disabled, successful and failed scheduled events in actual Workers runtime. Fix the Node/Workers redirect-mode difference: Workers uses manual redirects and rejects non-success responses without following them.
- [x] Pass TypeScript and lint; deploy disabled without secrets or schedules. The bootstrap deployment omits required-secret declarations only to create the disabled resource; tracked config retains them for activation validation.
- [x] Obtain approval for the additional encrypted secret destination and run `scripts/install-identity-monitor-secrets.mjs`. User approved; installation and four secret names verified, with no values logged.
- [x] Set `MONITOR_ENABLED` to `true`, add `19,49 * * * *`, deploy the tracked configuration and read back its version/schedule.
- [x] Observe a real cron execution and verify signed health delivery. At 15:19 UTC, live tail recorded cron `19,49 * * * *`, outcome `ok`, static success log and no exceptions. R2 readback confirms success with `eventAt=1790003947351` and `receivedAt=1790003949249`; public health returned HTTP 200.
- [x] Inspect initial hosted timing: wall time 3,225 ms; CPU time 10 ms. Actual account dashboard confirms **Workers Free**. This is one successful execution, not capacity proof.
- [ ] Establish CPU headroom and continued scheduled coverage before general release. The initial sample is at the documented Free 10 ms CPU limit. Do not treat the 40-identity subrequest guard as a CPU capacity guarantee. Reconcile the earlier note about an existing $5 subscription before any new paid-plan decision; no purchase made.
- [x] Confirm the already-sent Better Stack test alert arrived. Open Gmail inspected with user authorisation on 22 September: identity/recovery test message in Inbox, dated 21 September at 11:57 a.m. EAT. No additional email sent.

If credential installation or checks fail, keep the Worker disabled and use the existing manual combined workflow while investigating. Do not claim unattended monitoring is complete until hosted scheduled execution has been observed.

The scheduled-execution observation gate is now met. [Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) permit limited occasional CPU overruns, but sustained overruns can terminate execution. The observed success at 10 ms therefore does not justify broader pilot capacity or removing the independent missed-run alert. GitHub manual combined run `35616520323` also passed during activation; it remains a separate diagnostic path.

## Runtime overhead reduction

At 15:23 UTC, version `49576315-efae-4b4d-b815-29532e4aac8d` replaced the initial monitor version. It uses native streaming UTF-8 decoding and [Web Crypto HMAC](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) rather than Node Buffer/crypto compatibility. Credentials, checks, response limits, signature bytes and twice-hourly schedule are unchanged. This dedicated Worker has no remaining Node dependencies, so removing its compatibility flag is deliberate; the main app's runtime is unaffected.

Provider regressions, independent Node-HMAC signature comparisons, R2 delivery tests, native Workers success/failure events, UTF-8 boundary/size tests, TypeScript and lint pass. Deployment-reported startup fell from 8 ms to 3 ms. Startup time is distinct from invocation CPU time.

- [x] Observe the optimised version's real **15:49 UTC** cron: outcome `ok`, **8 ms CPU**, **2,776 ms wall time**, no exceptions and static success log. Version ID matches the deployed optimisation.
- [x] Independently read back the delivered R2 report: `eventAt=1790005747336`, `receivedAt=1790005748922`, status success. The actual external-monitor endpoint `/api/operations/health` returns HTTP 200 with `status: ok`.
- [ ] Collect continued coverage/capacity evidence before broadening the pilot. The observed post-change samples remain limited evidence, not a capacity guarantee for additional identities. No billing change has been made.

At **16:19 UTC**, the same optimised version passed a second real cron: **5 ms CPU**, **3,113 ms wall time**, outcome `ok`, no exceptions. Independent R2 readback reports success with `eventAt=1790007547320` and `receivedAt=1790007549049`; the external health endpoint again returns 200. There are now three observed scheduled successes, with optimised samples of 8 ms and 5 ms. This supports continuing the existing restricted pilot on the verified Free plan; broader identity capacity remains a separate gate. External test-alert receipt was subsequently verified on 22 September.


## 22 September continued observation and plan review

At 08:19 UTC the same optimised version succeeded with no exceptions, 10 ms CPU and 3,290 ms wall time. Private bounded-tail evidence is retained in `.sites-runtime/operations/identity-monitor-tail-2026-09-22-0819.json`. This provides continued coverage, but not CPU headroom. The Workers plans dashboard explicitly marks **Free / Current plan**; the billable-usage period on the overview does not establish a paid subscription.

Workers Paid is recommended at [a $5/month minimum plus usage](https://developers.cloudflare.com/workers/platform/pricing/) to remove dependence on the Free 10 ms CPU ceiling. A recurring-budget decision has been requested. No upgrade or purchase has occurred; expansion remains gated.


## Approved Paid activation

On 22 September the user explicitly approved $5/month plus usage, then separately approved the checkout terms and recurring charges. Cloudflare displayed **Purchase complete** and **subscription is active**. The earlier Free observations remain historical evidence. No further purchase is required for this transition.

A 1,000 ms monitor CPU limit is prepared and passes Wrangler deployment dry run. This is substantially above the observed 5?10 ms, while keeping a finite per-invocation budget. The 40-identity guard, response/deadline bounds, exact provider permissions, private trigger and external stale-report alert remain unchanged. Deployment and a subsequent actual scheduled execution must be recorded before checking post-upgrade verification.
