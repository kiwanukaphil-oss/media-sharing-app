# Shared workspace invitation repair ? 30 September 2026

The reported failure was the ordinary sign-in screen being used for brand-new invitees. Auth0 already exposes sign-up, but Relay did not offer an account-creation action. The sender creates a link; the application has no automatic invitation mail delivery.

## Revised journey

- The owner sees the sharing method before creating an invitation. The result offers a pre-addressed email draft with the complete link and onboarding instructions, plus Copy link. Opening a draft does not send mail; the owner sends it in their mail app.
- `/join` is a dedicated invitation page. Create account opens Auth0's hosted sign-up directly; existing users can choose Sign in. Account creation uses the invited email and a password chosen by the invitee.
- The fragment token remains in tab session storage through sign-up, email verification, interrupted sign-in and the callback. Callback recovery returns to `/join`, retaining verification guidance. Email verification in another tab requires returning to the invitation tab, or reopening the original link on the chosen device.
- Signed-in recipients see their current email, the workspace, access role and explicit Join library action. Wrong-account/unavailable previews offer account switching, retry and workspace recovery. Reopening a link on the same page refreshes the invitation.
- Accepting opens the shared workspace directly. Dismissing never joins. Personal libraries and existing membership are unchanged.

No schema, authentication provider settings, rollout binding or email-verification requirements change. Pilot admission now also permits a verified recipient of a current owner invitation. Unrelated sign-ups remain denied. Invitation authority is rechecked inside both person and session writes; revocation between the initial check and commit cannot admit a new account. After acceptance, the stable provider identity may sign in again, including after leaving the library, to retain account-management access. An email address alone never inherits an already accepted invitation. Workspace membership is still separately enforced. Invitation details are still disclosed only after the invited email is verified. Tokens never enter authentication URLs, server page URLs or logs. The email draft intentionally contains the owner's selected invitation link.

Auth0's documented `screen_hint=signup` selects the hosted signup screen: https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience . Live read-only inspection confirmed that this tenant already supports Sign up; no provider setting was changed.

## Verification

- [x] Signed OIDC fixture checks confirm signup hint selection without changing PKCE, state, nonce or ordinary sign-in.
- [x] Chromium, Firefox and WebKit invitation fixtures cover email draft content, new-user verification return, existing sign-in, wrong-account retry, explicit joining, same-page reopening and token cleanup. Provider/email responses are simulated.
- [x] Main production build, focused lint, TypeScript and existing entry journey pass. Main and production-compatible real-D1/API account and invitation regressions pass, including signup route-choice assertions.
- [x] Actual D1 verifies invited pilot admission, revoked/expired invitations, lost owner authority, unverified and unrelated identities, separate membership acceptance and subsequent sign-in.
- [x] Production-compatible final build, route/account checks (including revocation between precheck and transaction), deployment dry run and release pass. Source `b62a151` is deployed as Worker `3784f1d2-8bcd-4501-928c-61188507bef1` at 100%, 30 September 2026 04:27 UTC. Both-origin health/header/private-feed probes pass. The real hosted account-creation route lands on `/u/signup`; a signed-in invalid-link check renders account switching/retry, and dismissal clears the synthetic test token.
- [x] After owner admin sign-in, published English signup page title, heading, description, primary action, existing-account link and logo alternative text. A fresh live `/api/auth/login?screen=signup&session=temporary` handoff displays ?Create your Relay account?, the Relay logo, invited-email/new-password guidance, Create account and Sign in. The technical tenant identifier is absent from the page copy. Screenshot inspected and saved locally at `outputs/relay-signup-live.png`. Existing login branding and authentication settings remain unchanged; no account or email was created.
- [ ] Hosted CI is not green: run `36668549540` stops verification at dependency audit and its browser job fails in the unrelated `media-polish-browser` activity-button overlap. Final-source run `36668873548` confirms the same audit and media-polish failures. Local targeted invitation, entry, crypto, actual D1 and build checks pass; this does not claim the whole hosted suite passed.
- [ ] A real new-recipient account creation, verification-email receipt and join requires the recipient to complete their own credential and email steps. No real invitation or verification email was sent during this repair.

The production release uses `ui/album-library-live`, preserving schema 0020 and excluding unreleased backend changes on main. Pre-existing local prototype deletions are unrelated and excluded from commits.


## Follow-up: signed-in recipient without a workspace

The owner's real acceptance report exposed a missing recovery path: signup could succeed after the invitation tab context was lost, but the workspace chooser listed memberships only. A read-only production aggregate confirmed one enabled account with an unexpired pending invitation and no membership in its destination. No private identity or token was exported and no production membership was edited manually.

- [x] Include eligible pending invitations in the authenticated workspace response using the current verified email and the same live owner/session, expiry, removal and capacity checks as link preview.
- [x] Display named invitations prominently on workspace arrival and account libraries, suppressing the misleading empty-workspace state. One Join shared workspace action consumes the invitation and opens its destination directly. Tab storage and the original link are unnecessary for this recovery.
- [x] Share the atomic acceptance implementation between link-token and account-invitation selectors. The ID endpoint requires the invited verified account and same-origin POST. Lost-response retries can reopen an existing accepted membership but cannot revive removed access; link replay behaviour is preserved.
- [x] Chrome, Firefox and WebKit reproduce cleared tab storage, invitation discovery on workspace/account pages, explicit joining, direct album arrival and the subsequent persisted workspace list. Responsive screenshot inspected. These browser identity responses remain fixtures.
- [x] Main and live-compatible actual-D1 account/API suites pass, including invitation discovery, foreign-account/CSRF denial, real destination session/feed access after ID acceptance, lost-response retry and denial after membership removal. Build, TypeScript, focused lint and deployment dry run pass. Independent fixture users have separate simulated IPs so they do not share the login rate bucket; production limits are unchanged.
- [x] Deployed source `31a3eb1` as Worker `2b77151d-87b6-4615-b2bd-aa684f5a4fd8` at 100%, 30 September 2026 04:55 UTC. Both-origin health/header/private-feed probes pass. A second read-only production aggregate confirms one recoverable recipient invitation with current owner authority, no removed/current recipient membership and no personal-space target. The recipient can recover it from `/workspaces`; their actual join remains user-performed.

The prior release solved account admission but did not complete this real recipient's membership journey. This follow-up records that gap explicitly.
