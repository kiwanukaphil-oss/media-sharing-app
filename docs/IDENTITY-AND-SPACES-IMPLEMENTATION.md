# Identity and personal/shared spaces: implementation proposal

**Status:** Auth0 selected by the user on 19 September 2026. Provider adapter and configuration tests are implemented. Relay Web was registered on 20 September and redirect URLs saved. Secure client-secret handoff, recovery verification, account/session routes, migration and activation remain outstanding. No new identity system has been released.

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
| Allowed Callback URLs | `https://relay-media-exchange.kiwanukaphil.workers.dev/api/auth/callback` |
| Allowed Logout URLs | `https://relay-media-exchange.kiwanukaphil.workers.dev/` |
| Application Login URI | `https://relay-media-exchange.kiwanukaphil.workers.dev/api/auth/login` |

These URLs are reserved for the planned account integration and are not operational login routes yet. Use exact URLs, not wildcards. Test settings should be in a separate development application/tenant with explicitly allowed local callback URLs.

Required server settings are documented in [.env.example](../.env.example): `AUTH0_ENABLED=false`, tenant domain, client ID, client secret and fixed Relay origin. Keep client secrets in Worker secrets. The initial implementation accepts the provider-owned `*.auth0.com` tenant domain; custom domains require a separate issuer review. Local HTTP origins require an explicit test-only opt-in.

## Implemented preparation and evidence

- [Configuration validation](../lib/auth0-config.ts): disabled by default, complete required settings, fixed production HTTPS origin and provider-owned domain validation.
- [OIDC adapter](../lib/auth0-client.ts): pinned `openid-client` 6.8.8; authorization code flow, PKCE S256, state, nonce, a browser-binding value and a ten-minute transaction lifetime. Requires RS256 signature verification as well as issuer, audience and expiry validation. Discovery endpoints must remain on the configured tenant origin. The adapter returns verified identity fields, not provider tokens.
- [Protocol tests](../tests/auth0-client.mjs): a simulated provider issues real RSA-signed test tokens. Tests cover valid sign-in, wrong signing key/issuer/audience/nonce, missing ID token, expired or wrong-browser attempts, invalid redirect origins, wrong state, unverified email and provider code replay. These tests do not contact a live Auth0 tenant.
- Tests are included in the web verification workflow. [Public setup generator](../scripts/auth0-setup.mjs) emits the exact dashboard settings without secrets.

The adapter deliberately does not grant workspace access or merge accounts by email. It is not wired into production routes yet. Before activation, add server-side transaction storage with atomic consumption, an HttpOnly browser-binding cookie, person/session persistence, migration/claim rules, account/session endpoints, UI and corresponding integration/restore tests. The simulated provider's replay rejection is not a substitute for Relay's own one-time transaction consumption.

Implementation references: [Auth0 authorization-code flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/add-login-auth-code-flow), [openid-client](https://github.com/panva/openid-client). The client library supports Web API runtimes including Cloudflare Workers; a full Relay Worker/session integration check remains required.

## Dashboard registration verified ? 20 September 2026

- Tenant domain: `dev-q1z0b44pcvdxwni6.us.auth0.com`.
- Application: **Relay Web**, Regular Web Application. Public client ID: `2hUhais7L0l8WRwbya5P3WofAqNCfCE0`.
- Exact URLs in the settings table above saved successfully; RS256, OIDC conformity and Client Secret (Post) verified in the dashboard.
- Default connections are Username-Password-Authentication and Google. Passwordless is not configured. Their presence is not evidence that recovery email delivery or production Google credentials are ready.
- User asked to place the client secret in `.sites-runtime/auth0-client-secret.txt`, verified excluded from Git. Do not print its contents or include it in documentation. Transfer to server-only secrets during integration.
- Tenant is labelled Development and displays a trial. Production readiness and post-trial capabilities remain to be reviewed; no subscription or paid upgrade was selected.
- No account routes have been activated, and the live app is unchanged.
