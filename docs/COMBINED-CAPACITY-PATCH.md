# Combined capacity release patch

- [x] Based on the deployed navigation fix and schema 0020; no migration or unreleased feature required.
- [x] Private operator pool configuration joins exactly two libraries for capacity only. Upload, preview and publication reservations share an atomic allowance.
- [x] Aggregate usage requires current account ownership of both libraries. File access remains library-scoped.
- [x] Type checks, production build and built Worker concurrent reservation/privacy tests pass.
- [x] Hosted verification `35780653681` passed. Full backup `35814505652` and incremental `35821232068` passed; deployed Worker `37d3cc5f-9811-4ddc-94f0-fa00a82e9767` at 100% on 23 September 05:11 UTC. Both live library dialogs show the same combined 100 GB allowance; health/security checks pass.

The intended pool is 100 GiB combined for the existing personal/shared libraries. No real library identifiers are stored in Git. Pool configuration is active in production after Backblaze payment/cap setup and independently verified full and incremental backups from the updated main workflow. Do not deploy main's schema-0027 feature set as part of this patch. Removing an activated pool restores old quotas and is not a safe rollback; preserve files and prefer a forward fix.
