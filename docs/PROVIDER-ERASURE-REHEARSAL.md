# Provider removal rehearsal

Status: prepared and locally tested; live grant, creation and removal await specific owner approval. This verifies one provider boundary of P2-06, not complete account erasure.

## Concrete scope

- Tenant: `dev-q1z0b44pcvdxwni6.us.auth0.com`.
- Run: `67985336-e179-4145-986e-6729972793fe`.
- New subject: `auth0|relay-erasure-rehearsal-67985336-e179-4145-986e-6729972793fe`.
- Non-deliverable email: `relay-erasure-67985336-e179-4145-986e-6729972793fe@example.invalid`.
- Connection: `Username-Password-Authentication`.
- Separate temporary machine application: `Relay provider erasure rehearsal`.
- Requested grant: `create:users` and `delete:users` only, plus enable this client on the named database connection if required. The existing monitor keeps its read-only grant and independently verifies the exact profile and subsequent absence.

The test account is blocked from creation, unverified, marked with the exact run ID and given a random password held only in process memory. Verification email is explicitly disabled. It receives no Relay membership, personal space or media. Existing users are outside the operation scope.

## Permission limitation

Auth0's `delete:users` grant applies to users throughout the tenant; it cannot be restricted to this generated subject. Local guards limit this runner, but are not a provider-enforced one-user permission. Management access tokens cannot be revoked after issuance, and the documented default lifetime is 24 hours. Inspect actual expiry, keep the writer token memory-only, and revoke the temporary client grant/connection access after the test to prevent new tokens; do not claim that this invalidates an already issued token. No change to the tenant-wide token lifetime is included in this proposal.

Sources: [Management API user permissions](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api), [token lifetime and revocation](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens), [create-user parameters](https://auth0.com/docs/api/management/v2/users/post-users).

## Reviewed sequence

1. Obtain specific approval for this grant and generated account's creation/permanent removal. Configure the separate client and encrypted local credential handoff; no credential enters Git, chat or application runtime.
2. Independently require the exact subject to be absent. Persist creation intent before making one POST. A failed or ambiguous POST is held for review, never retried blindly or adopted by email.
3. Persist the returned creation receipt, then independently verify subject, creation timestamp, blocked state, zero login history, one database identity, email and run marker.
4. Re-read these bindings immediately before removal, persist removal intent and make one DELETE for the exact generated subject. Any changed binding stops the test.
5. Require acknowledged removal and independent GET absence. A timeout, denied request or ambiguous outcome cannot mark success or trigger an automatic repeat.
6. Record private evidence and remove the temporary grant/connection access. Report the actual token expiry separately. No real-person fulfilled ledger record is produced.

`scripts/provider-erasure-rehearsal.mjs` has no executable CLI or credential discovery. Its exported primitives require operator-supplied transports and durable evidence recording. Tests cover independent reader/writer selection, existing/changed/linked/activated identity refusal, missing durable evidence and ambiguous deletion without blind retries. Live operator wiring and the cloud result remain outstanding.

- [x] Implement and test the bounded provider adapter without live credentials.
- [ ] Obtain specific approval and configure the separate grant.
- [ ] Run generated-account creation/removal with independent verification.
- [ ] Revoke the temporary grant/connection access and record token expiry.
