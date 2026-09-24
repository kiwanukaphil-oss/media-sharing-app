# Relay album-first concept

This is a standalone, interactive HTML mockup for an album-first entry to the web app. It does not call Relay APIs, read live content or change the production UI. Sample content and any albums or files added in the preview reset on reload.

## Open

From the repository root:

```powershell
python -m http.server 4328 --bind 127.0.0.1 --directory prototypes
```

Open **http://127.0.0.1:4328/relay-album-first/**.

Captured review states: [desktop album index](desktop-preview.png), [opened album](album-preview.png), [phone album index after creation](mobile-preview.png).

## Design decisions

| User need | Mockup response | Reason |
| --- | --- | --- |
| Arrive with a clear place to go | Albums is the first view and the first navigation item. The landing screen contains album covers, names and counts, with no loose media grid. | A project or event is easier to recognise than a mixed feed of files. |
| Make a new destination | New album is the single prominent action on the index. Creation opens the empty album immediately. | The next step is visible and the result of creation is unambiguous. |
| Find a specific set of media | Search and sort operate on album names on the index. Opening an album reveals its files and one level of sections. | The navigation path narrows before exposing thumbnails. |
| Avoid hiding existing content | Unorganised has a named secondary route and a quiet callout beneath albums. Browse all files is an explicit secondary route. | Existing files remain reachable without making the broad feed the default. |
| Keep access understandable | The active space and album context stay visible. The detail screen says who can access the personal space. | Album membership and section placement do not imply a new permission boundary. |
| Work on a phone | Two-column album cards, a navigation drawer, fixed-size touch targets, and a compact detail toolbar. | Album selection remains the primary action without using horizontal carousels. |

The cobalt sidebar, orange creation action, cool canvas and compact card metadata follow the current Relay visual direction. Covers carry most of the visual weight; file tiles appear only inside the chosen album. The empty album uses a neutral folder illustration so an album can exist before a cover photo does. The broad file view remains visibly named rather than being confused with Albums.

## Review route

1. Land on Albums. Confirm there are no file thumbnails before opening an album.
2. Open **Spaces & stories**, switch between its sections, and open a file. The viewer stays within that selection.
3. Return to **All albums**, search and sort album names, then create an album. Confirm that its empty state points to Add files.
4. Open **Unorganised** and **Browse all files** deliberately from the sidebar.
5. At phone width, open the navigation drawer and check the same paths.

The Add files control accepts local image and video files for demonstration only. Local video playback works in the viewer; the sample video tile uses an illustrative still. Album and file actions are transient mockup state.

## Implementation boundary

Production adoption should open to an authorised, current-space album index without fetching or displaying an all-files feed on arrival. Existing deep links, current-space filtering, section placement, Unorganised, permissions, transfer destinations, recovery, and older clients still need to work. An album is an organisation container; access continues to come from the file's space and audience scope. This prototype is a design review artifact, so roadmap completion counts are unchanged.
