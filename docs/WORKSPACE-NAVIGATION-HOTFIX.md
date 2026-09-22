# Persistent workspace navigation - 22 September 2026

## Problem and correction

The plain homepage uses existing paired-device access. Its switcher and account links were conditional on the presence of a `space` URL parameter, so returning from Account to the homepage hid account navigation despite a valid signed-in session. This was a navigation defect, not lost membership.

Account navigation now independently reads current account libraries on every library entry route. The homepage exposes the same Personal/Shared choices as explicit workspace URLs. Account & libraries and the header Account link remain available during loading, signed-out paired access and request failures. Failed library-list requests show an explicit retry; a missing account session exposes no private library names. Selecting an account library starts a full navigation, preserving the existing transfer unload guard and destination handling. Existing paired-device access remains available.

## Verification and release

- [x] Chromium, Firefox and WebKit regression: plain home, account return, explicit personal/shared switching, home link, reload, mobile, failed list/retry and signed-out paired access.
- [x] Existing account-library browser coverage: scoped reads/previews, retained upload destinations, private queued-file isolation and access-loss clearing.
- [x] Final production build, focused lint, TypeScript, dry run and broader browser regression. A WebKit intercepted-request timing failure was corrected by waiting for loaded views and settled requests before navigation; the corrected three-engine test passes. Hosted verification job 35777476126 passed; corrected browser rerun 35777938239 is pending.
- [x] Deploy runtime `4aaa73a` as Worker `29137605-6bf6-4c2b-8631-5725b9d0d7c1` at 100% (20:04 UTC); both-origin health, security headers, storage/database readiness and anonymous-feed denial pass.
- [x] Verify the actual signed-in browser: formerly broken album URL now shows the switcher; personal view opens; Account > Back to library retains switching; shared choice opens the existing shared files. No user data was changed.

This hotfix branches from verified live source `9d81a1c` (runtime `402b6e4`), with schema 0020. It adds no migration, backend mutation, feature activation or new permission. The unrelated schema 0021-0027 release and backup/provider gates remain in place. Rollback to the previous live Worker is schema-compatible but restores the navigation defect; prefer a forward fix.
