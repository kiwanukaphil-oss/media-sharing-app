# Bulk save to device ? 30 September 2026

The live toolbar lacked a download action. It now offers Save selected to device, selection/size confirmation and an ordinary native ZIP attachment download. On iPhone the dialog explains Files extraction and saving supported media to Photos. Browser download UI owns progress/cancellation; Relay never claims an unobserved local save completed.

The read-only API validates 1?100 unique IDs, the complete accessible ready/non-Trash selection and the existing 2 GiB package bound before streaming. The initial precheck surfaces errors in the dialog, with individual download links for over-limit selections. The actual download authenticates independently and rechecks current actor/workspace/file authority before each original and before the ZIP directory. It cannot grant editing access. Read-only members now get selection/download controls on the compatible release without editing controls.

The ZIP writer streams one R2 original at a time with backpressure, SHA-256/size validation, standard CRC32, and no completed directory after abort, corrupt bytes or final access failure. Flat numbered filenames avoid duplicate-name collisions and nested opaque directories; the manifest retains original labels and checksums. No temporary archive is stored and no original is altered. Ordinary desktop/browser export behavior remains backward compatible. Only the validated bulk URL gets an 8192-character query allowance, to carry up to 100 IDs; other routes retain 2048.

Chrome and WebKit phone-size tests pass native attachment download and independent Python ZIP/CRC/exact-byte extraction, duplicate names, unauthenticated/foreign-library/archived selection rejection, and read-only member toolbar. Existing package tests cover corruption, truncation, denied originals, final revocation and cancellation without commit, and bounded chunks at 80 MiB and the full 2 GiB limit (1 MiB maximum write, approximately 17 seconds in the local synthetic test; this is not a hosted 2 GiB benchmark). Existing WebKit album/navigation regression passes. TypeScript, focused lint, main/compatible production builds and deployment dry-run pass. No schema migration or unrelated backend activation.

- [x] Runtime `d73fde4` deployed at 100% as Worker `66abd8c0-7559-4ef7-ae6a-b469d10c37d9` on 30 September 2026 at 05:54 UTC. Both-origin health passed. Canonical-domain Chrome downloaded a native ZIP from two existing originals in the isolated Relay verification library; independent Python extraction, CRC, size and SHA-256 matched every selected original. Phone-width dialog screenshot inspected. No live records changed during the check. Main runtime source: `9dc0fc2`.
- [ ] Physical iPhone Files/Photos handoff confirmation.

References: [Apple ZIP extraction in Files](https://support.apple.com/en-nz/102532), [Cloudflare streaming responses](https://developers.cloudflare.com/workers/runtime-apis/streams/). Reviewed installed Workers types 5.20260917.1 and current stream/best-practice documentation; no binding changes.

## Interface copy refinement ? 30 September 2026

At the user?s request, removed the two explanatory paragraphs from the bulk dialog and shortened its progress/download-request status. The dialog now contains its title, selection count/size and download action, plus concise status or errors when needed. Download behavior and enforced limits are unchanged. This interface-copy preference is recorded in AGENTS.md.

- [x] Deployed runtime `b2d326b` as Worker `12eab076-f42c-46f0-88f0-7e043ec580c7`. Focused lint, production build and deploy dry-run passed. Both-origin health and the real canonical-domain dialog check passed; phone-width screenshot confirms title, count/size and download action only in the ready state.

## Visual refinement ? 1 October 2026

Replaced the bulk download text button with the matching 19 px toolbar icon, preserving its accessible label and tooltip. The modal now uses the existing album-dialog serif typography and warm palette, a structured archive summary, clear close control, and aligned Cancel/Download footer. Dedicated close styling fixes inherited white toolbar icon colour. Preparation retains a stable disabled action; request feedback is concise. Cancel and Escape restore focus to the trigger.

Chrome/WebKit acceptance passed at 320, 430 and 1280 px, including close contrast, icon-only label, no horizontal overflow, focus return, native ZIP download and original-byte checks. Mobile screenshots inspected; TypeScript, focused lint, build and dry-run passed.

- [ ] Deploy and visually verify refinement.
