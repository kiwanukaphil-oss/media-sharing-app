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
- [ ] Production-compatible branch final build, route/account checks, deployment and live signup landing acceptance.
- [ ] A real new-recipient account creation, verification-email receipt and join requires the recipient to complete their own credential and email steps. No real invitation or verification email was sent during this repair.

The production release uses `ui/album-library-live`, preserving schema 0020 and excluding unreleased backend changes on main. Pre-existing local prototype deletions are unrelated and excluded from commits.
