# Hosted publication rehearsal

Verified 21 September 2026. This uses generated identities/content in separate Cloudflare resources. It is not a production account impersonation or an Auth0 test account; no request reaches Auth0.

| Resource | Dedicated rehearsal value |
| --- | --- |
| Worker | `relay-publication-rehearsal` |
| D1 | `relay-publication-rehearsal`, `a22d670e-2a20-4266-9f07-0601406a0d56` |
| R2 | `relay-publication-rehearsal`, private Standard bucket |
| Active test version | `3751e683-f11a-44bd-9544-665b200b198b` |
| Disabled final version | `115619c7-ec89-4789-925a-3dce03cdd60e`, 100% readback |
| Final access | Expired and disarmed; even a correctly signed request returns 403 |

Production D1 `relay-media` and R2 `relay-media-originals` are not bound to this Worker. No production credential is supplied. A separate short-lived HMAC key is held in Worker secrets and local DPAPI storage; it is not committed, printed or sent to GitHub. The endpoint accepts only fixed seed/run operation names with five-minute signed delivery freshness and a deployment expiry. No caller-provided SQL, object key, identity or destination is accepted. Initialisation refuses a populated application database or bucket.

## Results

- [x] Apply migrations through 0018 only to the new empty rehearsal D1.
- [x] Seed and read back four synthetic people, eight synthetic spaces and four generated originals. Production session/membership helpers establish the actor contexts.
- [x] Normal copy: distinct R2 destination key, matching SHA-256, original survives.
- [x] Interrupted copy: inject failure after the actual R2 write, verify the attempt is invisible and cleaned, retry the same operation and verify the independent copy.
- [x] Access revoked during write: revoke only the synthetic destination membership after writing bytes; verify publication never becomes visible and attempt keys are cleaned.
- [x] Cancellation during write: cancel the generated operation before visibility; verify the pending row and attempt objects are cleaned while the source survives.
- [x] Final D1 readback: six ready originals (four sources and two intended copies), two ready publications, two cancelled publications and zero unfinished publications.
- [x] Disable execution and set expiry to zero; deploy and verify signed/unsigned requests receive 403.

The unchanged production publication functions perform the copy and cancellation. Small interception hooks introduce the races after cloud writes. The local actual-schema/API suite separately covers request authentication, CSRF, cross-person/cross-space denial, quota contention, corrupt bytes, metadata/previews and retries. The real pilot UI and independent B2 restoration separately verify personal upload, explicit audience confirmation and original-byte publication.

## Reproduction and retention

`node tests/publication-rehearsal.mjs` runs the same Worker in disposable local D1/R2, including invalid signatures, stale requests, unarmed/expired execution and populated-storage rejection. It is included in Web checks.

For a further cloud run, first review the checked-in isolated resource bindings and create fresh case resources or deliberately reviewed fixture identifiers. Do not rerun completed revocation/cancellation cases as if they were fresh. Set a bounded future expiry, deploy with execution initially disabled, run `node scripts/run-publication-rehearsal.mjs seed`, independently inspect fixture-only storage, then arm execution and run the `run` command. Disarm/expire immediately after verification. The driver is pinned to the rehearsal host and checks exact resource IDs; production configuration must never be substituted.

The generated originals and the dedicated resource containers are **retirement candidates**, retained for review. No original fixtures or resource containers were purged. Only generated temporary copy attempts were removed by the workflow under test, with source preservation verified. No new paid subscription was selected; the test uses small existing-plan resources. This rehearsal does not complete account erasure or all-backup-version minimisation.
