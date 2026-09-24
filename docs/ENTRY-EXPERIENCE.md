# Intentional entry experience - 24 September 2026

## Journey and design

A fresh visit to relayalbums.com opens Relay's own welcome/sign-in page. Warm neutral surfaces, olive controls, restrained typography and abstract album illustrations connect it to the album library without displaying personal media. Credentials are entered in Auth0 Universal Login; Relay keeps the existing OIDC implementation and owns the pages before and after it.

After sign-in, the user chooses a workspace before the application shell loads. Personal and shared libraries have separate groups, visible names and roles, and an explicit opening action. Even one workspace is a deliberate choice. Selecting a card opens that workspace's Albums view. Existing direct workspace links retain their destination and access checks. The in-app Choose workspace link returns to the gate.

Temporary sessions remain the default (up to eight hours); Keep me signed in is an explicit seven-day choice for a personal computer. Existing paired-device access is preserved. Pending invitations return to the existing explicit review/acceptance screen. No invitation is silently accepted. Errors, expired sessions, loading and genuinely empty membership each have distinct recovery states.

## Verification and release

- [x] Implement welcome, login, workspace gate, sign-out and direct-link recovery in the schema-0020 live-compatible branch and forward-port to main.
- [x] Initial builds on both branches, real D1/API regression suite, Chromium/Firefox/WebKit entry fixtures, account navigation and main collection/delivery browser regressions pass. Browser identity/provider handoffs are simulated; these do not represent a real credential roundtrip.
- [x] Final builds pass on both branches; polished entry screens pass Chromium, Firefox and WebKit at 320-1440px. Invitation continuity, people controls and real album creation/navigation regressions pass. Desktop/mobile screenshots inspected. The provider fixture uses a document redirect for WebKit compatibility; server 303 callbacks are separately covered by the API tests.
- [x] Deployed live-compatible source `b2e5573` as Worker `f74624dd-74b1-42fe-b1ed-b624ba098e6d` at 100%, 24 September 2026 20:42 UTC. Both origins pass entry/header/health/private-feed probes. Real signed-in root shows the personal/shared chooser; opening Our shared space renders its existing two albums. Public hosted-login logo returns 200 image/svg+xml. Main forward-port is `0c2186b`; no unreleased backend was deployed.
- [x] Final focused lint and TypeScript check pass. Hosted [36056689500](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/36056689500) passes verification/API checks; browser job exposed independent fixtures sharing one loopback pairing-rate bucket. Browser-only emulation now gives that shared bucket room for the full suite. Production and dedicated API/security-test limits remain unchanged; the previously failing usability journey passes locally. Full browser rerun is in progress.
- [x] Published the public Relay wordmark, primary `#29382e` and page background `#f7f6f1` through standard Auth0 branding. Reloaded dashboard confirms persistence. English login and identifier-first screens use Relay title, description and logo alternative text. Auth0's actual hosted login preview visibly renders the wordmark, warm background, olive Continue button and new copy. No credentials were submitted during preview.
- [ ] Optional detailed theme refinements (input/link palette, corners and typography) remain unpublished: Auth0's visual editor repeatedly returns "Something happened while trying to customization settings". Standard branding saved successfully as a safe fallback; the rejected draft was discarded. Existing authentication/security settings were not changed.

Existing issuer, access rollout, cookies, session policy, API authorisation, bindings and database schema remain unchanged. Main's unreleased backend is excluded from this release. Previous Worker 488d7388-274f-4a48-990e-3a6d7316d667 is the schema-compatible rollback target.
