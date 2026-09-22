# Recovery monitoring and reconciliation

Updated 22 September 2026. Provider-side monitor implemented and locally tested; dedicated Auth0 authorisation and protected credential installation are complete. Hosted provider/identity checks now pass; signed health reporting and external monitoring are live. Twice-hourly scheduling is configured; test-alert Inbox receipt was verified on 22 September (message dated 21 September, 11:57 a.m. EAT). Restricted pilot remains active.

## What is already running

The twice-hourly `Identity operations` workflow reads only aggregate D1 signals. Its first [hosted run passed](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35576462943). It flags pending/restored deletion requests, unknown request states, inconsistent recorded recovery watermarks and stale live sessions. The [public health matrix passed for both origins](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35576467793). Neither check proves that Auth0 delivered every reset event.

## Dedicated provider check

`scripts/check-auth0-recovery.mjs` and the twice-hourly `Auth0 recovery monitor` workflow are ready for a dedicated **Relay Recovery Monitor** machine-to-machine application. Grant only Auth0 Management API **read:logs** and **read:users**. These are tenant-wide read privileges, so activation needs explicit security-access approval. The implementation requests only failure type/date for logs. For known Relay identities it excludes unrelated supported profile fields, then immediately retains only ID, blocked flag and last password-reset time in memory; any other returned attributes are discarded. No write, delete, client-management, secret-reading or password-reset permission is requested. Do not reuse Relay Web's client secret.

Store the new client ID and secret as `AUTH0_MONITOR_CLIENT_ID` and `AUTH0_MONITOR_CLIENT_SECRET` in the existing main-restricted `relay-backup-copy` GitHub environment. The job receives its existing D1 read-only credential and the new provider credential; it receives no R2/B2 credential or recovery-signing key. Never print or commit the secret. The new credential can read tenant user profiles and logs, even though the script selects fewer fields; field selection is data minimisation, not an authorisation boundary.

The check:

1. Reads at most 200 active Relay identities; exceeding that reviewed capacity fails closed.
2. Obtains a short-lived token for the pinned tenant Management API with the two read scopes.
3. Checks the retained 20-hour window for Action execution, password-change and reset-request failures. A single matching event is enough to require private review; no full log export is needed.
4. Retrieves each known provider identity by exact ID and compares its current reset timestamp against both Relay's person state and delivered-event watermark. Provider blocking, missing identities, malformed timestamps, failed requests and incomplete results are failures, not green reports.
5. Prints static status categories only. No profile, email, subject, IP, token, count or raw provider error enters public CI logs. There are no database/provider writes.

Before scheduling: verify least-privilege grants, securely install the credential, manually dispatch, inspect redacted output, configure operator failure notifications and provision missed-run detection. Verify actual email receipt separately before closing the alert-delivery release gate. Choose a cadence within provider/runners' limits. GitHub schedules are best effort; this is detection, not instantaneous revocation. The 20-hour log window is not permanent audit retention. An outage beyond retained logs can lose event history; comparing current account reset timestamps still detects newer unresolved resets for existing active identities.

The scope includes tenant-wide failure signals because the password-change Action is tenant-wide. A failure from another application is a review signal, not proof that Relay is affected. Investigate it privately. Do not silently suppress a recurring failure. Future tenant applications require a fresh scope review.

## Responding to a failure

The project operator opens the Auth0 tenant log's Action Details privately, verifies the bound Action version/settings and checks provider availability. A red run must not contain copied log payloads. Check the same issuer/subject in the current provider profile and private D1 records; never infer identity from email or device name. Preserve sessions authenticated after the verified reset.

For a confirmed missing notification, replay the verified provider timestamp through the existing signed recovery-event receiver using the operator-held recovery key and a current delivery timestamp. It uses the same monotonic, idempotent revocation path as the Action. Independently verify the watermark and revocation, then rerun both checks. Do not invent timestamps, lower a watermark, log the signed request, edit passwords or reset the database to clear an alert. This operator repair must be rehearsed with designated synthetic data before the general-release gate is checked.

For pending deletion requests, follow [the retention runbook](ACCOUNT-DELETION-AND-RETENTION.md). Monitoring never grants authority to delete. For missing/deleted or blocked provider identities, assess current access and record an explicit remediation decision; the monitor does not silently erase or relink accounts.

## Evidence and cost basis

Actual-schema tests cover the local queue and revocation invariants. Provider-boundary tests cover scopes/field minimisation, pinned destinations, reset mismatches, blocked/missing identities, capacity bounds, rate-limit/network failures, response-size limits and redacted output. Hosted provider testing passed (35579499914); combined checks and reporting passed (35580179355, 35580503181).

Auth0 documents [log retrieval through the Management API](https://auth0.com/docs/deploy-monitor/logs/retrieve-log-events-using-mgmt-api), [user-read scope](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api), and [Action failure event filters](https://auth0.com/docs/customize/log-streams/event-filters). Detailed execution traces remain a dashboard investigation; the generic log API is not a replacement for Action Details.

The current [pricing comparison](https://auth0.com/pricing) places log streaming on paid tiers. Polling avoids making the trial's stream availability a production dependency. Tokens for Auth0's own Management API [do not count against custom-API M2M token quotas](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens); rate limits still apply. No paid upgrade is authorised or selected. Recheck actual tenant entitlement after trial expiry.

## 21 September activation evidence

- User created Relay Recovery Monitor and saved permissions. An extra read:logs_users selection was removed; readback confirms exactly read:users and read:logs (2/273). Client ID: 1Rakur48pyVj6WOVy3Yyb4cY31E0IEpb.
- Both monitor settings were installed in the main-only relay-backup-copy environment. No credential printed or committed.
- Hosted run 35579243839 failed closed on a rejected provider request. Safe diagnostics now include only the request stage and HTTP status, never the provider response body. Monitoring is not yet scheduled or declared healthy.

- Diagnostic run 35579333179 isolated the rejection to profile retrieval (HTTP 400), after token and log requests succeeded. Profile retrieval now uses the documented field-exclusion mode to avoid including last_password_reset in the provider field allowlist. Tests verify exclusion of profile/identity metadata and retention of the required reset evidence. Hosted verification follows.

## Free-plan missed-run detection

- Hosted provider run 35579499914 passed after correcting profile field selection. Both scopes are sufficient; no wider grant needed.
- Better Stack's generic Billable label was initially mistaken for an exhausted allowance. The account is Free and [published pricing](https://betterstack.com/pricing) includes 10 monitors/heartbeats. The fourth monitor was accepted without an upgrade. The existing backup heartbeat stays separate.
- A small authenticated reporting endpoint, `/api/operations/health`, is implemented for the existing Worker. GitHub reports success only if both provider and identity checks pass. Public GET returns only ok/degraded; a failure, absent/corrupt report, missing key or report older than 90 minutes yields HTTP 503. Reports contain no identities, counts or provider details.
- A separate HMAC reporting key can update only the one R2 operational status object. Requests are bounded to 1 KiB and five-minute delivery freshness. Conditional writes prevent delayed or concurrent success from masking newer failure; duplicate reports do not refresh the deadline. This grants no account/media/recovery authority. Status is disposable operational state, not part of original-file backup manifests; an isolated restore starts unhealthy until checks run again.
- Real R2 emulator tests cover signatures, streaming limits, replay, ordering/races, freshness and fail-closed behaviour. Hosted failure reporting returned HTTP 503; successful real combined checks restored HTTP 200. Better Stack monitor 4956708 is Up and checks exact HTTP 200 every three minutes with three-minute confirmation/recovery, TLS verification, no redirects and email-only alerts. The user-authorised test alert is confirmed in Gmail Inbox: **Relay - identity and recovery checks - Sep 21, 2026 at 11:57am EAT**, inspected 22 September. Its example.com / Status 500 fixture distinguishes the test from subsequent real monitor notifications. The combined job is scheduled at minutes 13 and 43 UTC each hour; initial cron execution remains to be observed. Independent scheduled execution was subsequently verified as recorded below.

## Operator repair rehearsal - 21 September 2026

- [x] Run `tests/recovery-repair-rehearsal.mjs` through the actual-schema account integration suite in disposable D1. Provider token/profile/log responses and all identities are explicit fixtures; no live provider account or production data is changed.
- [x] Detect a provider reset newer than both stored watermarks while the old session is still accepted.
- [x] Replay the independently established fixture reset timestamp with a current, correctly signed delivery; read both watermarks back from D1.
- [x] Confirm older authentication is revoked, newer authentication and a different person remain valid, and library/media/device/membership fingerprints remain unchanged.
- [x] Repeat equal and older deliveries; verify monotonic state and preserved newer sessions. Retained provider failure logs still require review after a successful repair.

Run: `node scripts/ci-web-integration.mjs --account-access` after a production build. This is an isolated end-to-end data-path rehearsal, not a claim of a real production failure or a production identity repair. Live signed receiver acceptance and real notification-driven revocation were verified separately. For a real incident, the operator must establish the exact issuer, subject and reset timestamp directly from current provider evidence before signing a replay. Never use the synthetic fixture timestamp or identity in production. The monitor stays read-only and holds no recovery signing key.

## Scheduling incident - 21 September

At approximately 11:54 UTC, the active combined workflow on main had no scheduled executions since configuration, and its last manual success was at 09:05. The public endpoint correctly returned 503 for stale evidence. Production-health scheduled runs were also sparse relative to their twice-hourly cron. GitHub documents that [scheduled events can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule); the observed cause is missed dispatch, not a verified identity/provider failure. Manual combined run 35596479265 passed and restored HTTP 200. This is recovery evidence, not proof that unattended scheduling is reliable. A more dependable independent scheduler remains a release gate; do not increase the freshness limit to hide missed checks.

A separate Cloudflare scheduled runner was activated at 15:03 UTC after explicit approval of the encrypted credential destination. Its first real 15:19 UTC invocation succeeded, delivered the signed report and left public health at HTTP 200. [Evidence and remaining gates](SCHEDULED-IDENTITY-MONITOR.md). Existing provider permissions remain unchanged. The 10 ms CPU sample is at the confirmed Workers Free limit; CPU headroom remains unresolved; test-alert Inbox receipt is verified. No plan upgrade was made.
