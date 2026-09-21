# Independent scheduled identity monitor

Status: implemented and locally verified on 21 September 2026. Dedicated Worker `relay-identity-monitor` is deployed **disabled**, without credentials, cron triggers, preview URL or workers.dev endpoint. Disabled version: `879bdb26-99ab-4fd0-a8ef-09395e032983`. Activation awaits approval to store the existing read-only Auth0 monitoring credential in Cloudflare's encrypted secrets.

## Reason for the change

GitHub's twice-hourly combined monitor did not dispatch on schedule. At approximately 11:54 UTC the latest successful check was from 09:05; Relay correctly returned HTTP 503 for stale evidence. Manual run 35596479265 passed and restored HTTP 200. GitHub [documents delayed or dropped scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Do not weaken the freshness check to conceal missed executions.

Use a dedicated [Cloudflare Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) at minutes 19 and 49 UTC as an independent execution path. GitHub remains a separate diagnostic/redundant runner. Better Stack continues checking the existing aggregate health endpoint; neither runner can report success without completing both checks. Hosted cron execution and alert receipt still need verification.

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
- [ ] Obtain approval for the additional encrypted secret destination and run `scripts/install-identity-monitor-secrets.mjs`.
- [ ] Set `MONITOR_ENABLED` to `true`, add `19,49 * * * *`, deploy the tracked configuration and read back its version/schedule.
- [ ] Observe a real cron execution, verify signed health delivery and review CPU/request use. A manual check alone is insufficient.
- [ ] Confirm the already-sent Better Stack test alert arrived; do not send another without permission.

If credential installation or checks fail, keep the Worker disabled and use the existing manual combined workflow while investigating. Do not claim unattended monitoring is complete until hosted scheduled execution has been observed.
