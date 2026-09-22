# Scoped activity implementation

P3-03 implementation contract, 22 September 2026. Private favourites are independent of shared activity and never appear in this history.

- Record successful library changes with the current actor, space, action, time and bounded opaque resource references. Do not retain old filenames, email addresses, descriptions, invitation tokens or arbitrary request payloads.
- Commit the event in the same database transaction as the guarded mutation. A stale selection, denied request or failed storage operation must not produce a successful event. Do not reconstruct history for changes made before activation.
- Read only the active space under current account/device authority. Personal-space history remains personal. Resource references are internal and must participate in the later restricted-album access policy before restrictions are enabled.
- Show a compact history panel with actor/time, action and current-state guidance. Organisational changes are reversible using current file controls; permanent deletion is explicitly irreversible. A changed revision is described as changed since, never an invitation to replay an obsolete Undo.
- Start with in-app notices about new activity. Notices contain no filenames or thumbnails. They do not claim email, push delivery or cross-device read synchronization.
- Use bounded cursor pagination. Retain events with their library for now; do not silently purge existing history. Storage consumption remains subject to operational monitoring and existing request limits.
- Remove personal-space events during identity minimisation. Shared events retain opaque attribution to the existing minimised actor, displayed as Deleted member. Recovery must preserve this rule and quarantine old access.

## Acceptance tracker

- [x] Transactional recording for album/section organisation, file metadata, Trash/restore, successful arrivals and permanent deletion.
- [x] Current-authority history API, bounded paging, revision-state guidance and private-space isolation.
- [x] Accessible responsive history panel and privacy-safe in-app new-activity notice.
- [x] Conflict, rollback, revocation, actor minimisation and actual-export migration checks.
- [ ] Hosted checks, migration, deployment and live read-only verification.

This is an implementation contract, not a claim that these features are deployed. Access-control changes already retain separate membership events; invitation secrets and personal bookmarks must never enter library history.

Local evidence: `tests/library-activity.mjs`, `tests/activity-browser.mjs`, `tests/erased-snapshot.mjs` and `scripts/rehearse-activity-upgrade.mjs`. Pending migrations 0021/0022 preserve all 25 existing live tables in the private-export rehearsal. Release awaits hosted checks and resumed independent backup downloads (roadmap B06).
