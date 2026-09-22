# Upload-request operations

Prepared 22 September 2026. Intake remains disabled in production. This runbook and admission-pause implementation complete operational preparation, not the unresolved physical-disposition or live release gates.

## Limits and signals

Only a verified invited account can submit. Owners choose an immutable destination and reserve the entire promised allowance against the ordinary shared-space quota before issuing a request. A library can have at most ten unexpired draft/open requests. Each request permits at most 100 files, 250 MiB per file and 1 GiB total; defaults are smaller in duration and count. Closed requests release unused allowance while admitted/staged originals remain charged.

Every person/owner request uses the existing authenticated request limiter. Multipart admission additionally bounds part bytes, part count, attempts, outstanding capabilities and URL lifetime. Received files never enter normal feeds or preview processing before an authorised owner independently verifies and accepts them. Review downloads use attachment/octet-stream/no-store/nosniff handling; no active content is rendered inline. Automated external scanning and AI processing are not enabled.

Review elevated reservation pressure, repeated quota/rate-limit errors, abandoned receipts, checksum failures, owner complaints and unusual creation/part-admission volume. Record times, opaque request/space IDs and coarse counts in protected operator evidence. Do not put contributor emails, filenames, object keys, tokens, file contents or raw request bodies in public alerts or application logs. Review underlying identifying custody only through the authorised private inventory workflow.

## Containment and recovery

| Situation | Action | Preserved evidence / limitation |
| --- | --- | --- |
| One unwanted request | The authorised owner closes it using the existing revision guard. | Stops new invitation/upload admission; releases unused allowance only. Received or uncertain bytes remain accounted for. |
| Suspicious received original | Decline it reversibly; keep it outside the library. | Decline is not deletion or evidence of safe content. Restore returns it to review, never directly to publication. |
| Widespread abuse or storage pressure | Set `RELAY_INTAKE_PAUSED=true` through the normal verified deployment process. | Stops new request creation, recipient acceptance, reservation, part admission and completion. Owner review/close and existing recipient receipts remain available. |
| Broader security incident | Disable `RELAY_INTAKE_ENABLED` and follow the incident/identity runbook. | This disables all intake routes, including review. It does not itself reconcile or remove stored bytes. |
| Resume after a pause | Review current capacity and unresolved custody; close unwanted requests, verify the cause is resolved, then remove the pause deliberately. | Pause is temporary: still-valid accepted requests can resume. Do not confuse it with permanent request revocation. No new invitation or quota allocation is created by unpausing. |

An admission pause applies to requests reaching the updated application. Old signed capabilities and operations already admitted before rollout can remain in flight. Preserve every attempt/capability and exact object association; neither a successful deployment nor an expired URL proves storage quiescence. The full provider-specific deletion guarantee remains blocked on Cloudflare case 02338622.

For operational reports, the owner can identify and close the relevant request without exposing their library to the contributor. The recipient sees an explicit pause message and retained receipts. Any external support message still requires the project's specific sending authority; no automatic abuse email is implemented.

## Recovery and release checks

- [x] Built-Worker pause test with closure tracking rejects new requests/acceptance/reservation/part URLs/completion while retaining receipts, owner review/close and staged-byte accounting. No multipart attempt is created during the test pause.
- [x] Browser checks disable recipient file selection and new owner requests while leaving review actions enabled. Original interrupted-upload and review/decline/restore flows still pass.
- [x] Existing migration/minimisation tests preserve exact custody and accepted shared originals; restored requests remain quarantined.
- [ ] Hosted pause regression and production activation/monitoring evidence.
- [ ] Provider-specific in-flight disposition, independent backup verification and the complete generated-person lifecycle rehearsal before unrestricted operation or any erasure claim.

No spending threshold, provider account, production flag, file or recipient permission was changed while preparing this runbook.
