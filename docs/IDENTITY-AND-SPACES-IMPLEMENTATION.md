# Identity and personal/shared spaces: implementation proposal

**Status:** Phase 2 preparation. Provider account/setup is pending user input. No account migration or new identity system has been released.

This document makes the next dependency concrete while [Phase 1](ALBUM-SECTIONS-IMPLEMENTATION.md) is released. Progress remains in the [roadmap](DEVELOPMENT-ROADMAP.md).

## Recommended first release

Use a managed identity provider for recoverable person sign-in. Keep space membership, permissions, albums and original files in Relay's existing D1/R2 infrastructure. Do not move the media platform to an authentication vendor or infer people from existing device labels.

**Recommended candidate: Auth0 hosted sign-in**, with the exact enabled authentication/recovery methods reviewed in the user's tenant. This allows a distinct sign-in flow without assuming this Vite/Vinext app supports another framework's authentication middleware. Email-based passwordless authentication and passkeys are documented provider capabilities; availability, production email delivery, plan terms and tenant configuration must be checked before selection and implementation. This recommendation is an architectural judgment, not a completed integration evaluation or purchasing decision.

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

Implementation can proceed once the provider/account dependency is resolved. Nothing in this proposal authorises relabelling a shared album as private or migrating user ownership by guesswork.
