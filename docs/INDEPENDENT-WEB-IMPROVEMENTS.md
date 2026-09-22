# Independent web improvements

22 September 2026. The user requested completion of all unblocked remaining phases. Bring forward improvements whose actual dependencies are satisfied, rather than treating the open account-deletion lifecycle as a blanket implementation freeze. No new audience, permission, storage schema or guest grant is introduced by this increment. General identity/closure release remains gated separately.

## Retrieval and presentation

- [x] Add Photos, Videos and Other files filters alongside existing filename/date/album/section filters. MIME metadata determines type; originals are unchanged.
- [x] Add “Added by me”. For account access this uses the exact current membership attribution plus explicitly claimed legacy devices. For legacy access it means this paired device. No matching by names/email and no new cross-person enumeration endpoint.
- [x] Keep filter state in the current scoped URL; reload restores it. Empty-state recovery and Clear all include the new filters.
- [x] Add up to three recent current-library albums, ordered by latest visible upload or creation. Archived albums stay in Browse. No cross-space aggregation or extra private browsing history is collected.
- [x] Surface interrupted current-library transfers with a shortcut to the existing resume queue. Existing transfer destinations remain authoritative.
- [x] Add an accessible presentation cover for the whole library page, including names, previews, notices and transfer details. Background transfers stay mounted. A boolean in tab storage preserves concealment across reload; blocked storage is explicitly disclosed. This does not change permissions, cover the address bar/other pages or provide a security lock.
- [x] Verify actual-schema account/legacy attribution, cross-space isolation, positive/negative type queries and invalid filters. Browser checks cover scoped URL restoration, recent-album navigation, narrow layout, focus, reload concealment and a real upload completing behind the cover. Mobile screenshots inspected.
- [x] Add up to eight named saved views per verified library/actor in tab storage. Save search, category and validated filters only; never cache results, credentials, permissions or arbitrary URLs. Reload and filter restoration pass browser checks. Malformed/oversized/duplicate records and injected scope/URL fields are rejected or stripped. Storage failures never claim success. This first version is explicitly tab-local, not account-synchronised bookmarks.
- [x] Initial retrieval/presentation hosted CI `35713851326` passed verification and browser jobs.
- [x] Saved-view CI `35714352811` and final responsive CI `35715410132` passed both jobs. Runtime `ebf5e35f-a289-4ec8-ae5e-51b430f8f7d2`, source `c4c999d`, is at 100% (10:20 UTC). Both-origin health/access and signed-in live controls verified. The 320px regression in `35714770629` was corrected before parent acceptance. P7-01 and P7-04 are complete for the documented scope.

No new privacy claims are inferred for stored originals. Their existing metadata/location disclosure and verified-vs-browser-download distinctions remain in force.
