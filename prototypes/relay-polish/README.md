# Relay web design prototype

Reviewable concept for the approved **light creative workspace + dark immersive viewer** direction. This directory is separate from the production application. Nothing here calls Relay APIs or reads the user's shared files.

## Open

The review session runs at **http://127.0.0.1:4318/**.

To restart from the repository root:

```powershell
python -m http.server 4318 --bind 127.0.0.1 --directory prototypes/relay-polish
```

All required assets are local. No package installation or production build is needed.

## Review route

1. **Library:** compare the compact heading, immediate search, large previews, and visible album navigation with the current web app. Switch between grid and list.
2. **Viewer:** open a photo; use arrow keys, filmstrip, zoom, and the details toggle. Escape returns to the original thumbnail.
3. **Selection:** select files using checkboxes or their action menus. Try adding to an album, Trash, and Undo. Album membership is additive, matching Relay's existing model.
4. **Search and filters:** search filenames, filter photos/videos or the sample date groups, and clear active filter chips. An unmatched search shows a recovery action.
5. **Empty state:** open the “Next project” album. Try the sample transfer from its primary action.
6. **Responsive web:** narrow the browser to see the navigation drawer, wrapping toolbar, two-column gallery, and adapted viewer. At 320 CSS pixels the page action moves below the heading.

## Implemented versus simulated

Working local interactions: grid/list, filename search, sort, date/type filters, album browsing and creation, additive album membership, selection, Trash/restore/Undo, viewer navigation, zoom, details, responsive drawer, and transfer feedback animation.

Sample filenames, counts, file sizes, devices, storage, dates, and connection status are illustrative. They do not describe the live workspace. Uploads are simulated and do not read or transmit dropped files. Video files use static posters; playback, downloads, pairing, authentication, and durable persistence are outside this prototype. Reload or “Reset demo” restores the sample state.

The simulated date controls illustrate progressive disclosure; production implementation must preserve Relay's existing exact date ranges, captured/uploaded date modes, UTC semantics, batch filters, and deep links. The prototype does not replace these capabilities.

## Browser verification — 18 September 2026

- Inspected the wide desktop layout and all eight loaded gallery images in Chrome.
- At an observed 1309 × 818 CSS-pixel desktop viewport, the first gallery row begins approximately 244 pixels from the top and the page has no horizontal overflow. The browser's existing zoom means requested outer dimensions differ from CSS viewport dimensions.
- Verified viewer arrow navigation, details panel, Escape dismissal, and focus returning to the original preview control.
- Verified two-file selection, contextual action bar, sample Trash, Undo, and restored counts.
- Verified unmatched filename search and clear-search recovery.
- Verified video filtering produces two results and an active filter chip; clearing it restores eight results.
- Inspected the 390-pixel responsive gallery and empty album; tested the navigation drawer and sample upload entry.
- Inspected the 390-pixel viewer, checked for horizontal overflow, and verified its zoom toggle.
- Checked 320-pixel layout; corrected and rechecked list-view overflow.
- Observed sample transfer completion. No files uploaded.
- JavaScript syntax checked with `node --check`.

This is design QA in Chrome, not a completed cross-browser, screen-reader, performance, or WCAG conformance audit. Production implementation requires its existing regression checks and real transfer, permissions, filtering, and recovery coverage.

## Next phase, subject to approval

Apply the approved library shell and viewer to the existing React web app. Reuse its API, transfer queue, permission checks, filename/date metadata, pagination, album memberships, original-download verification, and recovery behaviours. Carry over advanced controls into the new filter/details surfaces rather than dropping functionality. Keep the native mobile application outside scope.

No production files were modified, no deployment was made, and no commit was created for this prototype.

## Sample assets

Photography is illustrative Unsplash imagery downloaded for this local design review:

| Local asset | Source image |
|---|---|
| interior.jpg | https://images.unsplash.com/photo-1600210492486-724fe5c67fb0 |
| living.jpg | https://images.unsplash.com/photo-1600607687920-4e2a09cf159d |
| architecture.jpg | https://images.unsplash.com/photo-1511818966892-d7d671e672a2 |
| chair.jpg | https://images.unsplash.com/photo-1598300042247-d088f8ab3a91 |
| details.jpg | https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85 |
| studio.jpg | https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea |

The icon sprite was generated from the installed `lucide-react` package. Its license is retained in `assets/LUCIDE-LICENSE`.
