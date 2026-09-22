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
- [ ] Complete saved views and hosted/deployed verification before marking the corresponding roadmap parents complete.

No new privacy claims are inferred for stored originals. Their existing metadata/location disclosure and verified-vs-browser-download distinctions remain in force.
