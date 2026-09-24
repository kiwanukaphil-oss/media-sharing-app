# Intentional entry experience - 24 September 2026

## Journey and design

A fresh visit to relayalbums.com opens Relay's own welcome/sign-in page. Warm neutral surfaces, olive controls, restrained typography and abstract album illustrations connect it to the album library without displaying personal media. Credentials are entered in Auth0 Universal Login; Relay keeps the existing OIDC implementation and owns the pages before and after it.

After sign-in, the user chooses a workspace before the application shell loads. Personal and shared libraries have separate groups, visible names and roles, and an explicit opening action. Even one workspace is a deliberate choice. Selecting a card opens that workspace's Albums view. Existing direct workspace links retain their destination and access checks. The in-app Choose workspace link returns to the gate.

Temporary sessions remain the default (up to eight hours); Keep me signed in is an explicit seven-day choice for a personal computer. Existing paired-device access is preserved. Pending invitations return to the existing explicit review/acceptance screen. No invitation is silently accepted. Errors, expired sessions, loading and genuinely empty membership each have distinct recovery states.

## Verification and release

- [x] Implement welcome, login, workspace gate, sign-out and direct-link recovery in the schema-0020 live-compatible branch and forward-port to main.
- [x] Initial builds on both branches, real D1/API regression suite, Chromium/Firefox/WebKit entry fixtures, account navigation and main collection/delivery browser regressions pass. Browser identity/provider handoffs are simulated; these do not represent a real credential roundtrip.
- [x] Final builds pass on both branches; polished entry screens pass Chromium, Firefox and WebKit at 320-1440px. Invitation continuity, people controls and real album creation/navigation regressions pass. Desktop/mobile screenshots inspected. The provider fixture uses a document redirect for WebKit compatibility; server 303 callbacks are separately covered by the API tests.
- [ ] Deploy only the live-compatible branch and verify both origins plus real signed-in workspace selection.
- [ ] Publish and inspect matching Auth0 hosted branding using the user's authenticated dashboard session.

Existing issuer, access rollout, cookies, session policy, API authorisation, bindings and database schema remain unchanged. Main's unreleased backend is excluded from this release. Previous Worker 488d7388-274f-4a48-990e-3a6d7316d667 is the schema-compatible rollback target.
