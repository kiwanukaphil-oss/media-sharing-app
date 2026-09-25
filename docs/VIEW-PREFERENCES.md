# Remembered layouts - 25 September 2026

The album file grid/list switch is visible beside the file count, including empty albums. It uses labelled 44px buttons and the Relay palette. On phones the redundant "In this album" text yields space to selection, count and layout buttons; Filters retains saved searches and sorting.

Album-home layout uses `relay-album-library-view`; files retain `relay-library-view`. Choices are independent browser preferences, restored after hydration and written only on user selection. Restricted storage retains a usable session choice. This does not sync layouts across devices.

## Verification

- [x] Main TypeScript and lint; live lint, build and deployment dry run.
- [x] Actual Worker album workflow passes Chromium, Firefox and WebKit, including independent preferences, reload, navigating back, and 320-1440px layouts. Mobile screenshot inspected; photo begins around 443px in the local fixture.
- [x] Section workflow and retrieval/presentation regression pass; organisation regression passes all three engines.
- [x] Prior hosted navigation release lint failure traced to a missing `memory` dependency in the live feed effect and corrected. Main already included it. Initial shared-preview attempts hit test pairing limits; reruns used the existing browser fixture limit. One WebKit cancelled-read event during concurrent tests passed on isolated rerun.
- [ ] Live deployment and signed-in verification.

No backend or schema changes; production remains schema 0020.
