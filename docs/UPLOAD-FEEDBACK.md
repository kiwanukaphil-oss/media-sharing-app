# Upload feedback ? 30 September 2026

The reported device is iPhone 15 Pro Max running Chrome. Exact source media/location and device timing have not been reproduced on that physical phone.

Selection now shows the complete queue before storage finishes. Every manifest starts saving immediately; sending still waits for persistence. Storage startup has a ten-second actionable timeout. The picker displays a waiting explanation until files arrive or selection is cancelled/dismissed. The OS may retrieve cloud-backed media before returning any files; Relay cannot show byte progress inside that native picker.

Integrity preparation runs in a dedicated worker. Files up to 32 MiB use native SHA-256; larger files use bounded chunks with progress. Restricted-worker environments retain the chunked fallback. Pause terminates the worker. Originals, destination capture and multipart resume remain intact. The queue stays serial to bound phone memory. Optional previews still run after each original.

The upload note explicitly explains phone foreground/screen-unlocked requirements. This is not durable background upload: closing the tab or OS suspension can interrupt sending; selecting the same original resumes persisted parts.

Validation: main Chrome and WebKit mobile-sized real-worker/delayed-preparation tests, byte-identical downloads, hash/cancellation unit checks, actual multipart API regression, and WebKit album navigation/destination regression passed before the native small-file optimization. Final release validation and deployment are recorded below.

- [x] Final release TypeScript, focused ESLint, production build and Wrangler dry-run passed. Chrome/WebKit exercised native hashing (3 MiB) and chunked hashing (33 MiB), verified immediate queue visibility during delayed worker startup, and downloaded every original byte-identically. Actual multipart/resume/isolation API checks and hash/cancellation checks passed.
- [x] Runtime `6448757` deployed at 100% as Worker `6d04846e-abe9-4a36-b904-1ff5ae0b1150` on 30 September 2026 at 05:28 UTC. Both production origins passed entry/header/database/storage/private-feed checks. The served integrity-worker asset matches the validated build byte-for-byte. Schema remains 0020. Main source: `c183dd8`.
- [ ] Physical iPhone confirmation of the original reported delay.

## Visible upload start - 13 November 2026

The owner reported that on an iPhone, after choosing several photos and videos and confirming, nothing appeared: no sign that an upload had started or failed, which led to repeated taps. Review of the released flow found three causes. The wait while the phone hands files to the page was shown only as a small toast. The start of an upload was deliberately quiet: the only sign was the compact indicator. A selection the queue refused (no authorised workspace identity, or a file already pending) was discarded with no message, and album, Trash and viewer refusals were checked only after the files had been chosen.

Changes: `Add files` now opens an upload sheet immediately. It shows `Getting your files` with the destination and an elapsed timer while the device prepares the selection, and the button reads `Getting files...` so repeated taps are not invited. When files arrive the sheet shows the count, destination, total progress, the current file and Pause/Details; on completion it confirms the result and collapses to the compact indicator after four seconds. Refusals are checked before the picker opens, and any selection that cannot start shows `Upload didn't start` with the reason. Queues restored after a reload stay quiet, as before. This supersedes the 1 October decision that new jobs never open a panel.

Limits: the page cannot observe progress inside the native picker, so the waiting state shows elapsed time, not a percentage. This is still not background upload.

Evidence: TypeScript and focused lint pass on `main` and the compatible release. A WebKit iPhone-profile check against the built Worker covers the held-open picker (waiting sheet and timer), upload, completion, collapse and a refused empty file, with no horizontal overflow; screenshots were inspected. `upload-workflow`, `upload-recovery` and `upload-feedback` browser tests were updated for the sheet.

- [ ] Physical iPhone confirmation by the owner.
