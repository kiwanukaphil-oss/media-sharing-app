# Relay — the album library

A working HTML design concept for intentional navigation: **space → album → section → file**. The arrival screen contains no photo thumbnails, video posters or mixed file feed. This is a local prototype, not a production release.

## Open the concept

From the repository root:

```powershell
python -m http.server 4322 --bind 127.0.0.1 --directory prototypes
```

Open **http://127.0.0.1:4322/relay-album-library/**. The HTML can also be opened directly; the local server is the verified route. No build or account is required. Illustrative photos reuse local assets from `../relay-app-refresh/assets/`; keep that sibling folder when moving the prototype. Fonts, icons and covers do not require external services.

## Why this design

| Decision | User experience reason | Concrete implementation |
| --- | --- | --- |
| Closed, illustrated album covers | The user's explicit request is to avoid exposing pictures on arrival. Even cover-photo thumbnails would partially undermine that. | Abstract CSS illustrations; zero image, video or file-card elements on the landing screen. |
| A recognisable collection for each purpose | Colour and shape support recognition; titles and counts carry meaning without relying on colour alone. | Six restrained cover palettes, stable collection numbers, visible titles, file/section counts and update dates. |
| One clear primary action | The home screen's main job is choosing or creating a collection. Uploading without a destination would recreate the original organisational problem. | Prominent New album action; Add files appears inside an album. |
| Progressive disclosure | Album management, file browsing and media viewing are distinct decisions. | Library → album gallery → explicit preview dialog. Browser Back and visible breadcrumbs preserve orientation. |
| Context before content | The user should always know which collection they are in and where new files will land. | Persistent workspace context, repeated album cover/title, explicit space/album/section destination before adding files. |
| Gentle treatment of existing loose files | Existing media must remain discoverable without repopulating the home screen with a feed. | A count-only Unorganised link and quiet reminder; opening that route is deliberate. Filing preserves sample originals and file identity. |
| Search that means what it says | Global results could unexpectedly reveal unrelated media. | Album search on home; filename search inside the opened album; neither searches across spaces. |
| Useful empty states | A new album is a valid, useful state before anything is uploaded. | Empty collection, empty section, no matches, no pinned albums and empty inbox each explain a next step. |
| A calm visual hierarchy | Media storage should feel composed and easy to scan, not like an endless social feed. | Warm ivory canvas, olive navigation, dark primary actions, editorial serif accents, consistent album geometry and restrained hover lift. |
| Responsive continuity | Mobile users need the same hierarchy and workflows, not a stripped-down gallery. | Two-column albums, scrollable section controls, drawer navigation, full-width search inside albums and responsive dialogs. |

These are design hypotheses grounded in the requested workflow and the project's product contract, not findings from customer interviews or a claim of formal accessibility certification.

## Try the main journeys

1. Arrive at Albums; try search, sorting, list view and pinning. No media is displayed.
2. Open **Slow Sundays**. Choose **Details** to show two files; filter Photos/Videos or search within this album. Open a photo and close with Escape.
3. Return to Albums and create a collection. Name and cover colour are enough; description and section templates are optional. Creation opens the empty album immediately.
4. Choose **Add files**. The destination names the current space, album and optional section. Select an existing unorganised sample or a local photo/video; local files are previewed with object URLs and never uploaded.
5. Open Unorganised to find remaining loose files. Switch to Studio space to see a separate sample album collection.
6. At mobile width, open and close the navigation drawer; use the same creation and browsing flow.

Native dialogs provide modal focus containment and Escape dismissal. The drawer makes background content inert, traps keyboard focus and returns focus to its trigger. Controls use visible focus outlines, accessible names and state attributes; result counts and status messages are announced. Reduced motion is respected. All user-entered strings are escaped before markup insertion.

## Verification and evidence

Run with the local server above:

```powershell
node prototypes/relay-album-library/verify.mjs
```

Verified locally in Chrome on 24 September 2026:

- Album-only arrival and return: six album cards, **zero media elements**.
- Search/no-results recovery, alphabetical sorting and grid/list switching.
- Six-file album, two-file Details section, type-filter empty state, clear filters and preview/Escape.
- Creation with literal HTML-like text; empty album; section templates; filing into the selected Details section.
- Unorganised count decreases after filing, with the original sample object retained.
- Separate sample personal/shared collections; reload resets demo changes.
- Local photo preview, browser Back and mobile drawer/Escape/focus return.
- No document overflow at 320, 390, 768, 1024 or 1440px; mobile album also checked.
- No browser page errors or failed HTTP responses in the scenario.
- Desktop, mobile, album and creation screenshots visually inspected. Initial desktop drawer-control visibility and two accessible-name issues were corrected before the passing run.

Screenshots: [desktop](desktop-preview.png), [mobile](mobile-preview.png), [inside an album](album-preview.png), [mobile album](mobile-album-preview.png), [creation](create-preview.png).

## Deliberate boundaries

Changes reset on reload. Sample videos are clearly marked placeholders; choosing a local video enables actual browser playback, subject to codec support. Actual uploads, permissions, durable transfers, album editing, custom section management and production deep-link migration are outside this mockup. Workspace separation here is a demonstration, not security enforcement.

Albums and sections organise media; they do not establish privacy boundaries. Production integration must preserve server-authorised spaces, multiple album membership, section placement per album, immutable originals, queued upload destinations, existing clients and legitimate access. Existing broad-library capabilities should be flagged for navigation retirement or relocated deliberately, not silently removed from production. This concept intentionally offers no All files shortcut on arrival.

The pre-existing `relay-album-first` folder was already locally deleted at task start. This replacement lives separately and does not restore or stage those deletions.
