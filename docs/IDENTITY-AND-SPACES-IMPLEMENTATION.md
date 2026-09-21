# Identity and personal/shared spaces: implementation proposal

**Status:** Auth0 selected by the user on 19 September 2026. Provider adapter and configuration tests are implemented. Relay Web was registered on 20 September and redirect URLs saved. Secure client-secret handoff is complete. One-time D1 login transaction storage and its migration are implemented and locally tested. Account/session routes, person persistence and account UI are now implemented and locally tested. Memberships, explicit owner claims and account-scoped library access are implemented locally. Personal spaces and a library switcher are also implemented locally. Recovery verification, lifecycle, identity migration and production activation remain outstanding. No new identity system has been released.

This document makes the next dependency concrete while [Phase 1](ALBUM-SECTIONS-IMPLEMENTATION.md) is released. Progress remains in the [roadmap](DEVELOPMENT-ROADMAP.md).

## Recommended first release

Use a managed identity provider for recoverable person sign-in. Keep space membership, permissions, albums and original files in Relay's existing D1/R2 infrastructure. Do not move the media platform to an authentication vendor or infer people from existing device labels.

**Selected provider: Auth0 hosted sign-in**, with the exact enabled authentication/recovery methods still to be reviewed in the user's tenant. This allows a distinct sign-in flow without assuming this Vite/Vinext app supports another framework's authentication middleware. Email-based passwordless authentication and passkeys are documented provider capabilities; availability, production email delivery, plan terms and tenant configuration must be checked before activation. Provider selection does not constitute a purchasing decision.

Alternative: Clerk, which documents email and passkey strategies and React sign-in components. Its component-led integration may be attractive, but it needs its own runtime, domain and production setup review. An existing user-owned provider should be considered before creating another account.

Primary references reviewed on 19 September 2026: [Auth0 passwordless API](https://auth0.com/docs/api/authentication/passwordless/get-code-or-link), [Auth0 passkey setup](https://developer.auth0.com/resources/labs/authentication/passkeys), [Clerk sign-in strategies](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options). These establish capabilities, not a tested Relay implementation. Recheck current documentation during integration.

## Required external setup

The next implementation needs a user-owned identity-provider application and the selected sign-in/recovery policy. Do not invent tenant details, create an account under an arbitrary email, accept commercial terms on the user's behalf, or place credentials in chat or Git.

After the provider is selected, prepare exact callback/logout URLs and required settings for the current Relay origin; then configure the application with the user. Keep client secrets in Worker secrets and any local development secrets in ignored files. Production login must remain disabled until configuration and verification are complete. A test tenant or mock provider can support local tests but does not substitute for an operational recoverable identity service.

## Person, device and space model

- A person is keyed by the provider's stable issuer/subject pair. A display name or matching email is not sufficient to merge accounts.
- Space memberships attach a role to a person. Devices become revocable sessions belonging to that person, with explicit active-space context.
- My space is a separate personal space. Shared-space owners cannot access it through their administrative role.
- Existing spaces remain shared. A currently authorised owner can initiate a reviewed claim linking their own verified identity to existing authority; other devices are never silently claimed as belonging to that person.
- Pair my device and Invite a person become separate flows. Legacy credentials remain explicitly labelled and bounded during transition; their access must not expand to new personal spaces.
- Switching spaces resets visible search and selection while leaving each queued transfer tied to its captured destination. Every API request validates the requested space independently of UI state.

Proposed additive tables/fields: people with external identities; person-space memberships; personal/shared space kind and personal owner; session-to-person links; explicit migration/claim records; scoped audit events. Final schema and migration require a reviewed provider-specific design and tests before writing production data.

## Authentication and recovery requirements

Use the selected provider's supported server-side or standards-based integration and maintained verification library. Validate issuer, audience, expiry and relevant flow bindings. Authorisation-code flows need state/nonce/PKCE as appropriate; redirects must be allowlisted. Do not accept a browser-supplied user ID, email or space ID as proof of access.

Keep provider authentication distinct from Relay authorisation. A valid sign-in does not grant access to an existing space. Claims need both verified new identity and proof of current authority, with replay protection and audit evidence. Test conflicting claims and repeated callbacks.

Account recovery restores the person's authorised memberships; it does not bypass revoked access. Temporary sessions, remote sign-out and provider logout semantics need explicit tests. The release must define what happens if the last owner loses access, if an account is deleted, or if a collaborator leaves. Do not promise recovery based only on a support request and a device nickname.

## Storage, ownership and publication

Do not multiply the existing storage allowance automatically for every account or newly created space. Account onboarding, space creation and quota allocation need a bounded initial policy before public sign-up is enabled. Preserve existing space limits during migration.

Shared uploads belong to the space under the declared product policy; member offboarding preserves the group's work. Personal files stay separate. Publishing from personal to shared initially creates a verified independent copy after an audience summary; the source remains private. Source deletion cannot recall the published copy or anything already downloaded.

Trash retention, backup retention and account deletion are separate policies. Record the actual operating policy before exposing account deletion. Restoring a backup must retain or reconcile deletion decisions and invalidate old access credentials as appropriate.

## Verification plan

1. Test login/callback failure, replay, mismatched issuer/audience and expired sessions in isolated environments.
2. Test legacy-owner claim, failed ownership proof, concurrent claims and no automatic device merging.
3. Verify that joining a shared space preserves existing memberships and does not expose My space.
4. Attempt cross-person and cross-space access through feeds, counts, covers, search, previews, originals, range requests, exports, activity and Trash.
5. Test space switches and revocation during an open viewer, queued upload and download; distinguish future authorisation from already-issued bearer links.
6. Exercise lost-device recovery, offboarding, ownership transfer and provider outages without losing existing legitimate access.
7. Restore all new records into an isolated environment, verify relationships and prevent expired/revoked credentials from becoming usable.
8. Verify keyboard, narrow-screen and recovery usability against the selected provider's actual configured flow.

Provider preparation is implemented; tenant configuration and session integration can continue once dashboard access is available. Nothing in this proposal authorises relabelling a shared album as private or migrating user ownership by guesswork.

## Prepared application settings

Run `node scripts/auth0-setup.mjs` to print these public settings. This script does not create an Auth0 application or expose credentials.

| Setting | Value |
| --- | --- |
| Application name | Relay Web |
| Application type | Regular Web Application |
| Token endpoint authentication | POST |
| Signing algorithm | RS256 |
| Allowed Callback URLs | `https://relayalbums.com/api/auth/callback` |
| Allowed Logout URLs | `https://relayalbums.com/` |
| Application Login URI | `https://relayalbums.com/api/auth/login` |

These URLs are implemented in the local account integration; they are not deployed or enabled in production yet. Use exact URLs, not wildcards. Test settings should be in a separate development application/tenant with explicitly allowed local callback URLs.

Required server settings are documented in [.env.example](../.env.example): `AUTH0_ENABLED=false`, tenant domain, client ID, client secret and fixed Relay origin. Keep client secrets in Worker secrets. The initial implementation accepts the provider-owned `*.auth0.com` tenant domain; custom domains require a separate issuer review. Local HTTP origins require an explicit test-only opt-in.

## Implemented preparation and evidence

- [Configuration validation](../lib/auth0-config.ts): disabled by default, complete required settings, fixed production HTTPS origin and provider-owned domain validation.
- [OIDC adapter](../lib/auth0-client.ts): pinned `openid-client` 6.8.8; authorization code flow, PKCE S256, state, nonce, a browser-binding value and a ten-minute transaction lifetime. Requires RS256 signature verification as well as issuer, audience and expiry validation. Discovery endpoints must remain on the configured tenant origin. The adapter returns verified identity fields, not provider tokens.
- [Protocol tests](../tests/auth0-client.mjs): a simulated provider issues real RSA-signed test tokens. Tests cover valid sign-in, wrong signing key/issuer/audience/nonce, missing ID token, expired or wrong-browser attempts, invalid redirect origins, wrong state, unverified email and provider code replay. These tests do not contact a live Auth0 tenant.
- Tests are included in the web verification workflow. [Public setup generator](../scripts/auth0-setup.mjs) emits the exact dashboard settings without secrets.

The adapter deliberately does not grant workspace access or merge accounts by email. It is not wired into production routes yet. Server-side transaction storage and the HttpOnly browser-binding cookie are now implemented and tested separately. Before activation, wire them into routes, add person/session persistence, migration/claim rules, account/session endpoints, UI and corresponding integration/restore tests. The simulated provider's replay rejection is not a substitute for Relay's own one-time transaction consumption.

Implementation references: [Auth0 authorization-code flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/add-login-auth-code-flow), [openid-client](https://github.com/panva/openid-client). The client library supports Web API runtimes including Cloudflare Workers; a full Relay Worker/session integration check remains required.

## Dashboard registration verified ? 20 September 2026

- Tenant domain: `dev-q1z0b44pcvdxwni6.us.auth0.com`.
- Application: **Relay Web**, Regular Web Application. Public client ID: `2hUhais7L0l8WRwbya5P3WofAqNCfCE0`.
- Exact URLs in the settings table above saved successfully; RS256, OIDC conformity and Client Secret (Post) verified in the dashboard.
- Default connections are Username-Password-Authentication and Google. Passwordless is not configured. Their presence is not evidence that recovery email delivery or production Google credentials are ready.
- User supplied the client secret in `.sites-runtime/auth0-client-secret.txt`, verified excluded from Git. Disabled local settings are prepared in `.sites-runtime/auth0-settings.json`. Do not print its contents or include it in documentation. Transfer to server-only secrets during integration.
- Tenant is labelled Development and displays a trial. Production readiness and post-trial capabilities remain to be reviewed; no subscription or paid upgrade was selected.
- No account routes have been activated, and the live app is unchanged.

## One-time transaction storage ? 20 September 2026

- `lib/auth0-transactions.ts` stores hashed state/browser lookups, issuer/client/callback binding, nonce, PKCE verifier and expiry in D1. A single `DELETE ... RETURNING` consumes an eligible attempt before token exchange. Wrong-browser/configuration attempts cannot consume it.
- `__Host-relay_login` is Secure, HttpOnly, SameSite=Lax, Path=/ and expires after ten minutes. Duplicate cookie values are rejected. Expired rows are purged when new attempts are stored.
- Additive migration `0007_auth_transactions.sql` is prepared but **not applied to production**. Existing people, memberships and access remain unchanged.
- Actual D1 tests cover concurrent callbacks (exactly one succeeds), replay, expiry, browser/configuration mismatch, cleanup and cookie properties. Backup restoration discards pending login attempts to prevent their revival.
- This remains an integration foundation: no account/session routes are enabled and no user login has yet been verified end to end.

## Production email dependency

The user confirmed on 20 September that they do not own a domain or use an email-sending service. Production recovery/sign-in emails therefore need a new sender setup. Recommended provider: **Resend**, which now has a supported Auth0 integration; use a verified sending subdomain of a user-owned domain. Domain choice, registration and account ownership must be resolved by the user. No purchase has been made or authorised by this recommendation.

Auth0's built-in sender is suitable for testing only, with no production reliability guarantee. Do not enable general production account onboarding until delivery, verification/recovery, sender identity and post-trial availability have been tested. Development with simulated identities can continue independently.

References reviewed 20 September 2026: [Auth0 email-provider guidance](https://support.auth0.com/center/s/article/Emails-to-Gmail-from-Auth0-never-arrive), [Resend's supported Auth0 integration](https://resend.com/changelog/auth0-integration).

## Purchased domain and routing ? 20 September 2026

- User purchased **relayalbums.com** in the existing Cloudflare account. Connected the root domain to the current production Worker without deploying new application code or database migrations.
- `https://relayalbums.com` is the intended primary origin. The previous workers.dev origin remains operational during transition. Existing cookies/browser-local transfer state do not automatically migrate between origins; finish queued transfers on the original origin and use the normal pairing flow on the new one.
- R2 CORS now allows both exact origins with the existing GET/HEAD/PUT methods and headers. No public bucket access was enabled.
- Auth0 login URI now points to the new origin. Exact callback/logout URLs for both origins are saved and were verified after reloading the dashboard. The current settings table above reflects the intended new origin. Sign-in routes remain unimplemented/disabled.
- Updated ignored local Auth0 settings and committed setup defaults to the new origin. Prepared deployment config explicitly preserves the custom domain on future deployments.
- Verified HTTPS/API health on both origins and the full hosted section workflow on relayalbums.com: direct original upload, section moves and Undo, removal/restore, deep links and byte-identical download. Only the established Relay verification space received a tiny retained fixture.
- Resend signup opened in Chrome. User must create/sign into their own free account, including password and terms acceptance. Proposed sending subdomain: `mail.relayalbums.com`; actual provider DNS records must come from Resend, never be invented.
- Existing external uptime monitors still target the workers.dev origin; moving/adding custom-domain monitoring remains an operational follow-up.

### Resend preparation

User created the free Resend account. The sending domain `mail.relayalbums.com` has been added in the Ireland region; receiving remains disabled. Provider-generated records are:

| Type | Host within relayalbums.com | Target/content |
| --- | --- | --- |
| TXT | `resend._domainkey.mail` | Provider-generated public DKIM key, available in the Resend domain setup screen |
| CNAME | `rsend.mail` | `rsend-euw1.forge.rmta.net` (DNS only) |
| CNAME | `send.mail` | `send.forge.rmta.net` (DNS only) |

User approved DNS publication, the domain-restricted sending key and Auth0 connection on 20 September. All three records are published and resolve publicly; both CNAMEs are DNS only. Resend now shows the domain as **Verified**; public CNAME, SPF and MX resolution was also checked. Receiving remains disabled.

Created **Relay Auth0 account emails**, with **Sending access** restricted to `mail.relayalbums.com`. User completed credential entry and saved Auth0's Resend provider. Reloading the page confirms the provider enabled, Resend selected, `Relay <accounts@mail.relayalbums.com>` persisted and the test-email action available. With explicit user permission, sent one Auth0 provider test email to the account owner. Resend shows **Delivered** for **Email Provider Configuration Test**, message ID `01a0bdc5-7ae1-7512-bf5f-d1e2ceb686b8`. The user also confirmed receipt. Provider delivery and inbox receipt are verified; real account recovery remains unverified. The key was not printed or stored in Git.


## Local account/session integration - 20 September 2026

`lib/account-api.ts` connects the existing OIDC and transaction adapters to login/callback and account-session routes. `lib/account-sessions.ts` persists the provider issuer/subject identity and a separate, hashed credential. Migration 0008 is additive and has only been exercised in disposable D1. `AUTH0_ENABLED` remains off in production.

Account cookies are Secure, HttpOnly, SameSite=Lax and host-scoped, with a fixed seven-day lifetime. Signing in rotates the previous browser credential. Every lookup checks account disablement, session revocation, expiry and issuer/client/origin binding. Cookies with duplicate account values are rejected. Account sign-out revokes only the selected person's session, and every mutation checks the exact application Origin. Backup restore invalidates all account sessions.

The `/account` screen handles disabled sign-in, signed-out state, account profile and active-session revocation, including retryable failures. Failed callbacks return a fixed, non-sensitive error state to this screen. Provider tokens never reach it. Session sign-out currently ends Relay account access only: provider SSO and legacy device sessions remain independent. Production activation must include a clear, tested provider logout/recovery policy.

No identity automatically becomes a member or owner, and no new space or storage allowance is allocated by signing in. This increment intentionally leaves file APIs on their existing device checks until explicit membership/claim integration is ready. Person accounts alone cannot be used as device credentials.

Local evidence: lint, TypeScript, build, real signed-token protocol tests, D1 route/session tests, existing API/security suite and backup restore tests pass. Phone/desktop browser checks cover disabled routes, session display and failed/successful revocation with mocked account responses. Live Auth0 sign-in/recovery, membership/claim migration and production release remain outstanding.


## Explicit owner-claim foundation - 20 September 2026

Migration 0009 adds `space_memberships`, `owner_claim_attempts` and `legacy_owner_claims`. The account screen can preview a library connection and explicitly confirm it. A claim requires a verified identity, a Relay session created within the last ten minutes and a current owner-device cookie. The preview names the account email, library and proving device. It does not grant authority until confirmed, expires after five minutes, and binds the confirmation to the same account session and owner credential. Confirmation tokens never appear in URLs.

The atomic D1 batch rechecks expiry, revocation, account disablement and device ownership at write time. One legacy device can claim only one person membership; different legitimate owner devices can link their respective owners. An existing membership, including a revoked one, cannot be overwritten by a legacy claim. Completed claim records remain as evidence, while expired attempts are purged and restores invalidate all pending attempts. Legacy device access is unchanged.

Membership listing is person-scoped. Existing media APIs still use device authorisation: this is an unactivated membership/claim foundation, not completed account-based library access. Migrations 0007-0009 remain unapplied to production. Tests cover competing accounts, replay, wrong-session/device proofs, post-preview device demotion/revocation/expiry, session revocation, person disablement and revoked-membership denial. The responsive preview/cancel/confirm UI was checked with mocked identity responses.

The user completed database-connection sign-up/sign-in and clicked the verification link. Auth0 user details now show VERIFIED after reload. This provider test does not substitute for Relay callback and recovery tests after runtime integration.


## Verification email deliverability - 20 September 2026

The user found the verification message in Spam. Gmail original-message summary reports SPF PASS, DKIM PASS for `mail.relayalbums.com`, and DMARC FAIL. Its spam notice cites similarity to previously identified spam; this does not prove a single cause. Cloudflare had no DMARC record. Added TXT `_dmarc.mail.relayalbums.com` with `v=DMARC1; p=none;`; Cloudflare readback, authoritative DNS and Google Public DNS confirm publication. This is an initial non-enforcing policy, without a reporting destination. Fresh-message DMARC results and inbox placement remain unverified; no additional email was sent. Review reporting and enforcement after validating legitimate senders.


## Account-scoped library integration - 20 September 2026

Requests select account space through exactly one `space` query value or matching `X-Relay-Space` header. Missing scope retains the legacy device path; present-but-invalid, disabled or inaccessible account scope fails closed without trying the legacy cookie. Every account request verifies the configured origin, hashed session, account state, membership and current role. Cookie mutations require Origin even when Authorization is present.

Migration 0010 adds `account_space_actors`, a unique membership-to-attribution mapping. An expired (`expires_at=0`) compatibility device row preserves existing media foreign keys and stable upload ownership across browsers. Its token field contains an unhashable-as-a-credential marker, no secret is issued, and its stored member role is never authority. It is absent from connected-device listings and cannot issue pairing invitations. This deliberately retains the legacy `device_id`/`deviceName` media contract; a future attribution-schema cleanup is a removal candidate after older-client review. Existing legacy uploads retain their original attribution.

The web library mounts with explicit scope from its URL. Account library links open it; library tools, section covers, previews, streaming saves and upload manifests carry the same scope. Scope is neither global client state nor a browser cookie. Full navigation retains the active-transfer unload warning, clears view state and permits resuming saved manifests at their original destination. A dedicated switcher and cross-space transfer tray remain outstanding. Denied account feed access clears visible library state and stops active transfers; late metadata responses cannot repopulate it. Already issued signed download URLs retain the existing expiry limitation.

Account-scoped device management and pairing return an explicit unavailable response until the person-invitation/device-linking workflow is implemented. Account sign-out remains under Account. No production migrations or login activation have been performed.


## Personal spaces, quotas and switching - 21 September 2026

Migration 0011 adds `personal_spaces` (unique person, space and recorded quota). Absence of a personal record means an existing shared library; nothing is relabelled. Both membership listing and file access require the personal owner, even if another person has an erroneous membership. Legacy credentials, owner claims and pairing redemption reject personal spaces.

Creation is an explicit Account action. Each personal library receives 1 GiB (1,073,741,824 bytes); the operator must configure `PERSONAL_STORAGE_BUDGET_BYTES` before any new allocations are possible. Default zero disables creation. A possible controlled pilot is a 10 GiB total allocation pool, supporting at most ten personal spaces; this is an operational proposal, not an applied production setting or purchase. Allocation counts promised quotas, not current usage, and a D1 transaction serializes concurrent attempts. Repeating creation returns the same library; revoked membership cannot be recreated. Existing shared libraries keep their 100 GiB limit. Personal quota applies to originals, previews, Trash and unfinished reservations.

The switcher groups Personal and Shared libraries and performs full navigation, retaining browser warnings for active transfers. It resets view state and restores unfinished manifests only when both stored space and attribution IDs match current account memberships. Sources remain on the user's disk; reselecting the original resumes. Queues display their destination and a return link; cancellation and restart address that captured scope. Personal files remain separate: cross-space publication is still unimplemented.

Configuration and migrations are local only. The production budget remains unset/disabled; real identity checks and the Phase 2 release gates remain outstanding.


## Temporary/trusted sessions and logout - 21 September 2026

Migration 0012 adds session mode and a nullable provider session hint. Existing session rows retain their original seven-day expiry and are labelled trusted; pending older login attempts default to temporary. New sign-ins default to eight-hour temporary access without cookie Max-Age. The optional trusted choice lasts seven days, with no sliding extension. The server stores this choice in the browser-bound, one-use transaction, so callback query manipulation cannot extend access. Browser restoration may preserve a session cookie; the UI therefore asks users to sign out on shared computers instead of promising that closing a window ends access.

Every provider login requests `prompt=login` and `max_age=0`; the maintained OIDC library verifies signed authentication time. A remote Relay session revocation cannot silently recreate access from an existing Auth0 SSO cookie. Current-browser sign-out first revokes Relay access, clears its cookie and then navigates to Auth0's OIDC logout endpoint. Only the configured client and exact registered application root are used. The signed `sid` claim is retained server-side as a logout hint, not exposed by account/session listing. No ID/access/refresh tokens are retained. If no hint exists, Auth0 may ask for consent; consent protections remain enabled. Social-provider sessions and legacy paired-device access are separate, explicitly described boundaries.

Implementation follows [Auth0 OIDC logout](https://auth0.com/docs/authenticate/login/logout/log-users-out-of-auth0). Real tenant logout/redirect and recovery remain release gates; local route tests do not prove them. Password-reset invalidation of existing Relay sessions is still a lifecycle requirement before activation.


## People and membership lifecycle - 21 September 2026

Account libraries now have a dedicated People & access screen. Using another device means signing in to the same account; inviting someone else creates a Member invitation for a specified verified email. Creation sends no email. The owner manually shares the generated link, whose token stays in the URL fragment and then this tab's session storage through sign-in. Acceptance requires an explicit named-library preview. No preview, token possession alone, device label or matching email between provider identities implicitly links accounts.

Invitations last seven days, work once and are bounded to 20 outstanding per shared library. The recipient limit is 100 active memberships, matching bounded library rosters. The issuer must remain an active owner. Invalidated/expired links and revoked sessions fail in the accepting transaction. Rejoining a removed person needs a new owner-issued invitation created after their removal; it restores Member access using their stable membership attribution, never their former owner role.

Membership changes use an expected revision and durable event in one D1 batch. Removing, leaving or demoting the last active account owner is rejected, including races. Handover consists of making another active member an owner before leaving or demoting oneself. Removal preserves shared files. Claimed legacy devices follow revocation/demotion and their unused invitations expire. Other legacy devices cannot reliably be assigned to a person; their presence is disclosed and they require separate review from an authorised legacy owner device. Comprehensive migration/offboarding remains a release gate. Issued file URLs and downloaded copies cannot be recalled by membership removal.

Restore sanitization suspends every restored membership, including personal ownership, pending deliberate reconciliation with current authority and incident records. It preserves earlier revocation timestamps, identity, content attribution and audit evidence. It does not automatically reauthorise anyone from snapshot-era grants. See [restore reconciliation](BACKUP-RECOVERY.md#membership-reconciliation-after-restore).


## Explicit publication - 21 September 2026

The personal-file viewer exposes Publish shared copy directly. The user selects a shared library and optional album/section, reviews the audience and embedded metadata, then confirms. This creates a separate immutable original; removing its personal source cannot recall the destination or downloaded copies. All shared-space members and legacy paired devices can access it, including people owners invite later. This phase does not claim restricted album audiences.

Publication is initially one file at a time, up to 1 GiB, matching the personal-space allowance. No file traverses browser memory for this copy: R2 streams source bytes to a new attempt key and validates the original SHA-256. Available bounded JPEG previews use R2 MD5 validation. Only a successful D1 commit exposes the copied original, after rechecking live account/session, personal ownership, destination membership, source revision and album/section availability. Destination quota includes originals, Trash, unfinished uploads and pending publication reservations. A thumbnail appearing after reservation cannot increase the promised allocation.

The publication identifier is idempotent and binds person/source/revision/destination. Pending intent is recoverable from the server after reload. Each attempt has a distinct object key retained in `publication_attempts`, a five-minute lease and a maximum of ten attempts per operation; an old worker cannot overwrite a newer result. Failed objects are removed before resetting the attempt. Source-owner or destination-owner cancellation releases the reservation only after storage deletion is acknowledged. The creator can also cancel their destination reservation through Storage. An already published copy requires the normal shared-library Trash workflow. Interrupted attempt keys are retained for operational reconciliation; hosted interruption/orphan-cleanup verification remains a release gate.

Restore converts unfinished publications into cancellation-required state, with memberships and sessions already suspended. It never resumes a historical sharing intent automatically. Published records and independent original bytes remain part of normal backup verification.

Checksum semantics were checked against [Cloudflare R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). Local tests exercise real D1/R2 and production routes. Race tests use a tiny-fixture Node bridge to inject changes before the production commit; this buffering exists only in the test bridge. Hosted runtime/large-file verification remains outstanding.


## Password-change invalidation (21 September 2026, local)

`lib/account-recovery.ts`, migrations 0016-0017 and `deploy/auth0/*.cjs` implement provider-to-Relay recovery coordination. The trusted identity key remains issuer + subject, never email. Password timestamps are integer Unix milliseconds; signed `auth_time` is converted from seconds. Authentication in the same second but before the precise reset timestamp is deliberately rejected: start a fresh sign-in rather than relaxing the boundary.

The Post Login Action adds the required `https://relayalbums.com/credentials_changed_at` ID-token claim, using 0 only when Auth0 reports no password-reset history. Relay requires this claim and a fresh signed authentication time. A database batch advances the person's watermark, revokes older authentication and issues a new session only at or after that watermark. A stale in-flight callback cannot recreate access after a reset. A successful sign-in also reconciles a reset whose notification was missed.

The Post Change Password Action sends only issuer, subject and reset time to `POST /api/auth/recovery-event`. This exact route uses HMAC-SHA256 verification instead of browser Origin authentication; no other account mutation is exempted. It authenticates the timestamp plus body, bounds the body to 4 KiB, allows a five-minute delivery window, and uses Web Crypto verification. D1 stores one monotonic watermark per identity, including notifications before an identity exists locally. Duplicate and reordered events do not revoke newer authentication. Unknown identities receive the same response. No passwords or provider tokens are sent or stored.

### Activation checklist (outstanding)

- [x] Generate an independent 32-byte random secret (64 lowercase hex characters) in an ignored local file, without printing it.
- [ ] Complete user entry/submission in Auth0 and store the identical ASCII hex value as Worker `AUTH0_RECOVERY_SECRET` and Action `RELAY_RECOVERY_SECRET`; never place it in Git or output.
- [ ] Install `deploy/auth0/post-login.cjs` in the Post Login flow; set Action `RELAY_CLIENT_ID` to Relay Web's client ID. Missing or mis-scoped installation prevents sign-in by design.
- [ ] Install `deploy/auth0/post-change-password.cjs` in the Post Change Password flow; set `RELAY_ISSUER` to the exact tenant issuer and `RELAY_ORIGIN` to `https://relayalbums.com`. The Action sends only to that pinned production origin and follows no redirects.
- [ ] Apply migrations and configure the webhook before enabling the Action/login. Test with a designated account, including two Relay sessions, password reset, revoked old sessions, fresh sign-in, and genuine provider logout.
- [ ] Configure redacted alerting for Action delivery failures and exercise reconciliation: inspect the affected provider identity securely, obtain its current reset timestamp, and replay a correctly signed event through the operator channel. A password reset is not declared verified until delivery and monitoring work.
- [ ] Before disaster-recovery cutover, reconcile provider reset timestamps/current account status and recovery watermarks alongside membership decisions. Restored sessions and memberships already start revoked.

The Action awaits up to two four-second HTTP attempts and reports only a fixed error on failure. Auth0 runs this trigger asynchronously and does not block a successful password reset on delivery. Thus notification is **not a guarantee of instantaneous invalidation**; an outage can leave an old session valid until successful reconciliation, explicit revocation or expiry. Signed-login reconciliation reduces that window when the user signs in again. The current work does not claim the real recovery gate is complete.

Primary references: [Auth0 Post Change Password trigger](https://auth0.com/docs/customize/actions/explore-triggers/post-change-password), [Post Login event user fields](https://auth0.com/docs/actions/reference/post-login/post-login-event-object). Tests cover authentic/forged notifications, body limits, expiry, issuer isolation, duplicate/out-of-order delivery, pre-signup events, callback races, unaffected accounts, missing signed claims and Action retry limits. No live Action configuration or recovery email was performed in this increment.


## Legacy audience reconciliation (21 September 2026, local)

Account owners can use People & access to review paired devices without possessing an old owner-device credential. `lib/legacy-reconciliation.ts` rechecks active account ownership in writes, excludes personal spaces and lists at most 100 active devices with an honest total. Disconnecting reviewed rows allows the owner to inspect subsequent rows. Only immutable owner-claim evidence supplies a person label; other device names remain explicitly unverified.

The owner may disconnect one named device or explicitly end all paired-device access. The latter revokes all currently valid legacy credentials and invalidates unused pairing links from revoked issuers in a single D1 batch. Concurrent pairing either completes first and is revoked with the other devices, or fails against the revoked issuer. Account attribution actors are already expired and remain untouched. The account owner and other people retain their memberships and file attribution. Unlike legacy-only device administration, this path may safely retire the last paired owner because a live account owner is required in the mutation itself.

The confirmation names the effect on native clients, preservation of shared files/account access, and inability to recall prior downloads or already issued links. No device is automatically revoked by migration, name matching or merely opening the review. Individual revocation does not infer ownership of other devices; a complete account-only audience requires explicit retirement of all remaining paired access. This is a migration control, not native account UI development. Live device review remains outstanding.


## Deletion review and current retention (21 September 2026, local)

Migration 0018 and `lib/account-deletion.ts` add auditable requests with a unique active request per person. Account API routes preview, explicitly submit and withdraw; submission requires a live account authenticated within five minutes and no shared library lacking a surviving account owner. Requests are idempotent under concurrency. They do not disable an account, erase media or notify an external recipient.

The Account screen explains shared-copy retention and the actual all-version backup policy before confirmation, then shows an honest pending/withdrawn status. Restore changes pending intent to `review_required`, never back into executable deletion authority. [Account deletion and retention](ACCOUNT-DELETION-AND-RETENTION.md) defines the operator review query, inventories, authorisation, revocation/deletion ordering, independent verification and restore gates. Request monitoring and the irreversible executor/rehearsal remain outstanding; the parent lifecycle feature is not complete.

## Provider configuration evidence (21 September 2026)

Dashboard access is restored. Relay Web retains the enabled Username-Password-Authentication connection. Google was enabled with Auth0 development keys; it is now disabled for Relay Web only. The connection and other applications are preserved. Dedicated production credentials and provider verification are prerequisites for offering Google later. Passwordless/passkeys are not configured for this launch.

The [published Auth0 plan](https://auth0.com/pricing) includes database login on Free; the dashboard displays a free allowance of 30 active Actions/Forms, sufficient for these two Actions. No paid upgrade was selected. The tenant is still marked Development and displays 20 trial days remaining. This is baseline suitability, not proof of post-trial operation or failure-monitoring availability. [Auth0's development-key guidance](https://support.auth0.com/center/s/article/Warning-Occurs-About-Development-Keys-When-Tenant-Is-In-Production) supports withholding this Google connection from production.

- **Relay password-change claim** (`14093a4e-0323-4097-8e01-df1f78987ee2`): Post Login, Node 22, Relay client setting saved, source deployed. Hosted testing with a complete synthetic event returned the expected ID-token claim and timestamp `1789862400000`. Connecting it in the flow remains pending: automated drag did not persist, so the prepared flow is handed to the user for drag and Apply. A deployed Action is not a bound trigger.
- **Relay recovery notification** (`1f615ce8-2e02-4c42-8680-02d91b7afd38`): Post Change Password, Node 22, public issuer/origin settings saved. Corrected and verified the entire saved draft against `deploy/auth0/post-change-password.cjs` (normalised LF SHA-256 `8f2771f2e9ac5d24f9a485840d503d6702da40c378ca03b139697562b79a0b70`). The Define Secret dialog is prepared for user entry of `RELAY_RECOVERY_SECRET`. The Action is not deployed or bound. Do not bind it before the receiver and monitoring are ready.
- Application inventory showed Relay Web and Default App. Post Change Password is tenant-wide for database users; future applications must account for this scope. Unknown-identity notifications establish only a recovery watermark, never membership or access.

The recovery secret is generated locally and ignored by Git. The user subsequently saved it in Auth0; the setting name and saved draft were verified without reading its value. The login Action is now connected and applied. One recovery-test email was authorised on 21 September but has not been sent. Matching Worker receiver and monitoring remain outstanding.

### Restricted pilot before general release

`AUTH0_ENABLED` remains the master switch. Enabled runtime settings now also require explicit `AUTH0_ROLLOUT=pilot|open`. Pilot requires `AUTH0_PILOT_SUBJECTS`, a JSON array of one to ten provider subjects in a private Worker binding. The fixed issuer supplies the other half of the identity key. The public runtime file defaults to disabled/pilot with zero personal allocation. An absent, malformed or empty pilot list fails closed; no email-based matching occurs.

Signed-token completion and account-session creation independently reject an unlisted subject before identity persistence. Canonically sorted audience values are included in session and callback configuration hashes, so credentials issued under a different audience configuration cannot be used in the current one. Moving from pilot to open requires fresh sign-in. The webhook continues to record tenant recovery watermarks; this never grants an unlisted identity Relay access. Pilot admission also grants no library membership: legacy ownership still needs its explicit claim workflow.

The restricted pilot permits live callback/recovery verification before general availability. It does not close Phase 2 or bypass monitoring, lifecycle, privacy, backup and publication gates. `scripts/rehearse-identity-upgrade.mjs` accepts a private Phase 1 SQL export, upgrades only an isolated in-memory copy, and reports structural preservation without printing private rows. Its first production-snapshot rehearsal passed on 21 September.
