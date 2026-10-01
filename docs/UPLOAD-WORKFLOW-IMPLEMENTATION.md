# Upload workflow implementation

1 October 2026. Implements the [workflow assessment](UPLOAD-WORKFLOW-REVIEW.md). Deployment receipt is recorded below separately from local acceptance.

## Result

Uploads belong to the application session. Moving among albums, workspaces, Account and Uploads retains the original file objects and immutable destination. A compact indicator stays available; details open only on request and can always be hidden. Phone layouts use the full Uploads page. No restored queue opens a modal or steals focus.

The queue distinguishes preparation, uploading, finishing, deliberate pause, offline, another tab, missing permission, missing original, failure and completion. It provides byte-weighted progress, measured speed/time estimates, per-file and batch pause/resume/cancel, destination context and completed-item clearing. Clearing history never deletes a delivered original. Validation reports mixed selections together. Similar names do not block distinct originals.

## Recovery contract

- Current-tab file references survive internal navigation.
- Supported desktop pickers retain file handles. Reload checks existing permission silently; renewal is an explicit button action.
- Other pickers retain recovery bytes when a file is at most 32 MiB, the total cache stays within 256 MiB, and estimated storage leaves 256 MiB headroom. This is bounded best-effort storage, not a guaranteed permanent copy. ArrayBuffers avoid WebKit's Windows IndexedDB File/Blob failure.
- Large originals without a retained handle remain current-tab sources. If that source is lost, bulk Locate originals matches SHA-256, even after renaming. Wrong same-size files are rejected. Old jobs without a digest require explicit replacement confirmation.
- Browser shutdown, phone locking, eviction, permission revocation and private browsing can interrupt work. No claim of OS-level background uploading is made. The UI states when the tab must stay open.
- Server receipt reconciliation runs before source recovery; a lost completion response cannot force reselection of an already delivered original. The receipt requires the exact existing upload owner/current authority and contains no object key or storage credential.
- Offline work resumes on reconnection; deliberate pauses remain paused. Retries are bounded and honour Retry-After. Part transfers detect no-progress stalls.
- Web Locks coordinate sending and destructive queue actions across supported tabs. Older browsers without Web Locks retain single-tab operation but cannot guarantee cross-tab exclusion.
- Explicit sign-out aborts work, drains tasks and clears that actor's local manifests and source cache. Expired account authority removes account queue names while allowing a separately valid paired-device session.

## Local acceptance

TypeScript, strict web lint and production builds pass on development and the isolated schema-0020 release checkout. Real D1/R2 transfer tests verify owner-only no-store receipts, multipart resume, exact bytes, range downloads, cancellation safety and access isolation. Development account/backend regressions pass.

Browser acceptance covers Chromium, Firefox and WebKit reload recovery, quiet restoration, route continuity, immediate queued pause, exact bytes, lost completion response and responsive widths. Additional tests cover a 33 MiB missing original, wrong-byte rejection, renamed hash matching, simultaneous tabs, denied storage, immutable workspace destinations and sign-out cleanup. Desktop handle acceptance uses installed Chrome and a real serializable file handle; only the OS picker/permission response is simulated. Bundled headless Chromium crashed on this Windows handle fixture, so Chrome is the verified fallback.

The offline/online test preserves explicit pauses, cancels unadmitted local jobs and verifies that cancellation after server commit retains exact delivered bytes. Cancellation waits for its own pause lock before checking another tab.

Focused existing album navigation, sections, entry, upload feedback and bulk ZIP regressions pass. Physical iPhone/iPad locking, OS file-provider prompts and OS picker persistence require device acceptance; browser emulation is not claimed as that evidence.

## Release status

- [x] Implement and verify the application-owned workflow locally.
- [ ] Deploy the schema-0020 compatible release with existing bindings, variables and secrets preserved.
- [ ] Verify both live origins and an exact-byte upload/recovery journey in the isolated Relay verification library.
- [ ] Physical iPhone/iPad acceptance.

No schema migration or original deletion is part of this release. Development main includes unreleased backend features and must not be deployed. Compatible release uses `.sites-runtime/album-library-live`. Pre-release rollback is Worker `89be1406-81b8-4301-9b36-e6311bc491dc`.
