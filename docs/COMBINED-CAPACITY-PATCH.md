# Combined capacity release patch

- [x] Based on the deployed navigation fix and schema 0020; no migration or unreleased feature required.
- [x] Private operator pool configuration joins exactly two libraries for capacity only. Upload, preview and publication reservations share an atomic allowance.
- [x] Aggregate usage requires current account ownership of both libraries. File access remains library-scoped.
- [x] Type checks, production build and built Worker concurrent reservation/privacy tests pass.
- [ ] Hosted verification and live activation remain outstanding.

The intended pool is 100 GiB combined for the existing personal/shared libraries. No real library identifiers are stored in Git. Pool configuration is absent in production. Activation requires Backblaze payment/cap setup and independently verified full and incremental backups from the updated main workflow. Do not deploy main's schema-0027 feature set as part of this patch. Removing an activated pool restores old quotas and is not a safe rollback; preserve files and prefer a forward fix.
