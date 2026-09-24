# Storage facts presentation - 24 September 2026

The user requested available space beside used storage and a professional facts display instead of explanatory paragraphs.

- [x] Sidebar shows used and available with explicit labels. Authorised pooled totals use the combined allowance, rather than a single-library subtotal.
- [x] Panel leads with available space, capacity and a usage meter, then current-library usage, Trash, reservations and relevant upload actions. Existing cancellation confirmation and capability checks are retained.
- [x] Available equals limit minus total used, clamped at zero. The API includes previews, Trash and reservations in used; no double counting. A restricted pool or partial-audience response displays availability as unavailable and does not imply a partial meter represents whole-allowance usage.
- [x] Local build, focused lint and TypeScript checks pass on live-compatible and main branches. Storage UI fixtures pass Chromium/Firefox/WebKit (pooled, standalone, unavailable totals, over-limit, cancellation capability and 320px layout). Account-library regressions pass on both branches, and the album workflow passes. Desktop/mobile panel captures inspected under `outputs/storage`.
- [x] Deployed source `6db29b4` as Worker `488d7388-274f-4a48-990e-3a6d7316d667` at 100%, 24 September 2026 13:04 UTC. Both origins pass health/security/private-feed probes. Signed-in sidebar and panel show combined usage 132.7 MB, 99.9 GB available of 100 GB and separate library usage 130.7 MB; Trash/reservations remain distinct subset rows. Live screenshot inspected.

Hosted follow-up [36003141462](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/36003141462) is running at this record update; local and live acceptance above is complete.

Production stays at schema 0020; no API, quota, binding or migration change. Source remains isolated on `ui/album-library-live`, with the same UI forward-ported to main without activating its unreleased backend. Previous Worker `86791371-16db-4cd4-a219-6950927bccbb` remains a schema-compatible rollback target.
