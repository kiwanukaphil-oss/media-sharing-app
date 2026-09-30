# Upload feedback ? 30 September 2026

The reported device is iPhone 15 Pro Max running Chrome. Exact source media/location and device timing have not been reproduced on that physical phone.

Selection now shows the complete queue before storage finishes. Every manifest starts saving immediately; sending still waits for persistence. Storage startup has a ten-second actionable timeout. The picker displays a waiting explanation until files arrive or selection is cancelled/dismissed. The OS may retrieve cloud-backed media before returning any files; Relay cannot show byte progress inside that native picker.

Integrity preparation runs in a dedicated worker. Files up to 32 MiB use native SHA-256; larger files use bounded chunks with progress. Restricted-worker environments retain the chunked fallback. Pause terminates the worker. Originals, destination capture and multipart resume remain intact. The queue stays serial to bound phone memory. Optional previews still run after each original.

The upload note explicitly explains phone foreground/screen-unlocked requirements. This is not durable background upload: closing the tab or OS suspension can interrupt sending; selecting the same original resumes persisted parts.

Validation: main Chrome and WebKit mobile-sized real-worker/delayed-preparation tests, byte-identical downloads, hash/cancellation unit checks, actual multipart API regression, and WebKit album navigation/destination regression passed before the native small-file optimization. Final release validation and deployment are recorded below.

- [x] Final release TypeScript, focused ESLint, production build and Wrangler dry-run passed. Chrome/WebKit exercised native hashing (3 MiB) and chunked hashing (33 MiB), verified immediate queue visibility during delayed worker startup, and downloaded every original byte-identically. Actual multipart/resume/isolation API checks and hash/cancellation checks passed.
- [x] Runtime `6448757` deployed at 100% as Worker `6d04846e-abe9-4a36-b904-1ff5ae0b1150` on 30 September 2026 at 05:28 UTC. Both production origins passed entry/header/database/storage/private-feed checks. The served integrity-worker asset matches the validated build byte-for-byte. Schema remains 0020. Main source: `c183dd8`.
- [ ] Physical iPhone confirmation of the original reported delay.
