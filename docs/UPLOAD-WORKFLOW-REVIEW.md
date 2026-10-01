# Media upload workflow review

1 October 2026. Original assessment and proposed design. See [implementation and deployment evidence](UPLOAD-WORKFLOW-IMPLEMENTATION.md) for current status.

## Recommendation

Replace the automatically expanded transfer tray with an application-wide upload manager: a compact persistent status control, an optional non-modal detail panel, and a full Uploads page. Selection starts work; it does not take over the application. Closing the panel hides it without cancelling work. Returning to Relay never opens upload details automatically.

The larger change is ownership: transfers must belong to the signed-in application session, independent of the album, workspace, account screen or panel being displayed. Keep each job's original destination immutable. Recovery must distinguish an upload that can continue automatically from one that genuinely needs access to its original.

## Evidence and current failures

Reviewed `components/relay-app.tsx`, `components/account-workspace-navigation.tsx`, `lib/transfers.ts`, `lib/previews.ts`, the upload API, layout and existing upload browser acceptance. The schema-compatible live checkout has the same core selection, scheduling and recovery behaviour. This is source inspection, not a claim of reproducing the user's physical iPhone session. The existing upload-feedback tests cover selection latency, worker hashing and byte-identical delivery, but not dismissibility or route-independent recovery.

| Finding | Consequence | Priority |
| --- | --- | --- |
| The tray renders whenever any transfer exists. Its X only forgets completed transfers. | The apparent close control does nothing to unfinished uploads; logging in reintroduces the obstruction. | Critical |
| IndexedDB stores manifests, not source bytes or persistent file handles. Restoration changes every unfinished record to `needs-file`. | Reloading loses usable sources, even for a deliberately paused job. There is no distinction between recoverable, missing-source and server-completed work. | Critical |
| File objects, controllers and the serial scheduler belong to `RelayApp`. Workspace switching uses `window.location.assign`; account links also leave the document. | Internal navigation can terminate work and force source selection again. Album navigation within the same component is better, but the app-wide promise is inconsistent. | Critical |
| Resume selects one file at a time. Size is checked first; hashing subsequently checks identity when a saved hash exists. | Recovery of a large batch becomes repetitive. A queued job without a saved hash cannot be identified safely by size alone. | High |
| Going online refreshes the feed, not the upload queue. Parts have three short retries and a ten-minute request timeout. | A temporary outage can leave users manually restarting work; stalled connections can look stuck for too long. | High |
| Preparation, sending and completion are compressed into a short state list. Every retry hashes the full original before server status is checked. | Large videos can spend substantial time apparently starting again, even if the server already completed them. | High |
| Pause aborts a queued controller but its visible state is updated when its serial task runs. | Pausing a later file may not provide immediate, trustworthy feedback. | High |
| Completion is shown before preview work and final manifest persistence finish. A failed feed refresh can enter the scheduler's generic error path. | A delivered original can appear unfinished or be reported as failed due to an unrelated refresh/storage problem. | High |
| Validation errors overwrite one shared error string; there is no batch summary, aggregate byte progress or stable time estimate. | Mixed selections and gigabyte batches are difficult to understand or manage. | Medium |
| The queue has per-file controls but no comprehensive batch workflow. | Too many repetitive actions for hundreds of files; noisy destination text consumes phone space. | Medium |

Preserve the good foundations: original bytes are not re-encoded, hashing is off the UI thread, buffers are bounded, completed multipart records are retained, destinations are captured at selection, API authority/quota checks exist, and previews are optional. The standard completion route checks assembled size; do not label that an independent server-side checksum verification. Existing exact-byte tests are evidence of tested paths, not proof that every production upload has been independently rehashed.

## The experience to aim for

1. **Choose a destination.** In an album or section, Add files inherits the visible destination. A global Add files action asks for a destination once. Keep the workspace, album and optional section visible beside the selection; changing the page afterwards never redirects files.
2. **Choose or drop files.** Use the native media/file picker, support multiple selections and desktop drop. Show the returned selection immediately. During cloud-backed picker preparation, show a brief waiting state, not invented transfer progress. Cancelling returns to the unchanged library.
3. **Start without a blocking wizard.** Ordinary valid selections queue immediately. Present exceptional items together: zero-byte files, too-large files, unavailable destinations or insufficient capacity. Let valid files continue where admission is safe. Folder mapping warrants its own review; ordinary photo selection does not.
4. **Keep browsing.** A compact control reads, for example, `Uploading · 12 of 48`. Its progress is weighted by bytes, not the average file percentage. Desktop details open as a side panel that leaves the library usable. On phones use an explicit Uploads screen with a Back action and persistent compact status. Neither interface opens itself at login.
5. **Offer useful control.** Pause all, resume eligible jobs, retry failed jobs, add more and cancel unfinished jobs. Individual controls remain in details. Cancel is separate from Hide and Clear history. Pause updates immediately, including queued jobs. A cancelled in-flight part can need retransmission; acknowledged parts remain reusable.
6. **Resolve problems in place.** Show `Waiting for connection`, `Sign in to continue`, `Allow file access`, `Locate originals`, `Storage full` or `Destination unavailable`. Resume is reserved for jobs that can actually resume. Failures do not steal focus or prevent unrelated uploads finishing.
7. **Finish accurately.** Mark an original complete only after server confirmation. Refresh and thumbnail failures cannot demote it. Use a quiet completion notice with Open album; retain a compact recent receipt. Mixed outcomes say `46 uploaded · 2 need attention`, never `All done`.
8. **Return quietly.** Reconcile saved jobs with the server before asking for anything. Already-delivered jobs become complete without the original. Eligible interrupted work can resume; user-paused work remains paused. Missing-source work contributes to an attention badge, not a modal.

## What “background” can mean

| Situation | Proposed guarantee |
| --- | --- |
| Browse another album, section, account page or workspace inside Relay | Uploads continue, tied to the captured destination, while that job's access remains valid. Requires persistent app ownership and client-side routing. |
| Minimise upload details | Uploads continue. Hide is presentation only. |
| Switch desktop tabs/apps | Continue when the browser allows execution; reconcile after throttling or suspension. No unconditional guarantee. |
| Refresh, crash or reopen | Restore progress and server state. Recover sources through retained handles or complete local copies where possible; otherwise offer bulk location. |
| Lock an iPhone, close the browser, terminate the app | No guaranteed continued upload from the web page. Preserve progress and recover when reopened. |
| Open on another device | Show authorised server status, but do not imply that original bytes on the first device moved to the new device. |

Persistent desktop file handles can avoid repeated selection; permissions still need checking and may need a user gesture to renew. Browser-private copies can help supported devices recover, but use real disk space and are quota/eviction dependent. They cannot be advertised as an unlimited, guaranteed phone backup. [Chrome file access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Chrome persistent permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api), [WebKit background behaviour](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/), [WebKit private file storage](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/).

Recommendation: retain in-memory sources across all internal routes; progressively use persisted handles where supported; offer bounded local recovery copies when capacity permits. Never silently duplicate a multi-gigabyte selection onto a nearly full phone. Check actual capabilities rather than browser names. Record whether each source is memory-only, handle-backed, fully staged or missing. Partial staging is not a recovered original. A screen-wake option may help foreground phone sessions but is not background execution.

If uninterrupted uploads after phone lock become a firm requirement, that is a separate native-transfer capability decision. Native UI work remains outside the current project scope. A PWA/service worker should not be presented as a shortcut to that guarantee.

## Recovery and edge-case contract

| Case | Required behaviour |
| --- | --- |
| Network drops, captive portal or unstable Wi-Fi | Pause transmission on offline signals; use bounded jittered retries for transient failures and reconcile on return. A browser online flag alone is not proof the server is reachable. |
| Rate limiting / server outage | Respect Retry-After; show retry timing, allow manual retry, avoid retry storms. Do not repeatedly retry permission or validation failures. |
| Session expires | Stop admitting new requests, retain eligible progress, provide sign-in recovery. Recheck the account and authority before resuming. Never send another account's queued files. |
| User signs out | Stop jobs, clear visible private metadata and apply an explicit local-source retention policy. A new account must never inherit readable handles, copies or manifests. |
| Reload after the completion response was lost | Ask server for authoritative status using the stable job ID; recognise completion before asking for a file or retransmitting. |
| Original moved, permission revoked or source evicted | Explain the actual cause; offer Allow access or Locate originals. Selecting a folder/batch matches many jobs at once. Unmatched files are not uploaded automatically. |
| Same size/name, different bytes | Never substitute silently. Validate saved identity with a full digest; metadata only narrows candidates. If a queued original had no trustworthy identity yet, require an explicit replacement/restart decision. |
| Duplicate selection | Avoid adding the same live job twice. Existing-library duplicate assistance must remain access-scoped. Offer skip/use existing/keep both only when content identity is verified; never silently overwrite or probe another audience. |
| Filename collisions / unusual formats | Preserve distinct originals and exact names safely; no automatic overwrite. A missing codec or poster does not mean the original failed. |
| Capacity exhausted mid-batch | Preserve successes and admitted reservations; stop affected admissions, show space needed and remaining files. Server admission stays authoritative; a client preflight is advisory. |
| Album deleted, archived, section removed or access revoked | Stop affected jobs with a precise reason. Do not silently redirect to Unorganised or another audience. Offer an explicit authorised destination change/restart if supported. |
| Switch workspace | Continue jobs against their original library client. Restrict detail visibility to current authorised membership, not the selected screen alone. |
| Two tabs restore the same job | One transfer owner per job, coordinated with a lease/lock and safe takeover. The other tab displays status. Keep server idempotency as the final protection. |
| Multipart session expired | Distinguish restart-required from retry; explain which bytes must be resent and preserve the source when available. Never discard reusable progress merely to tidy the UI. |
| Hundreds of photos / very large videos | Bound hashing, transfer and thumbnail concurrency; virtualise long details; keep aggregate controls responsive. Start with safe serial large-file sending and benchmark a small photo lane before increasing concurrency. |
| Browser storage unavailable/full | Degrade explicitly to an in-session upload where safely supported, rather than making all upload depend on IndexedDB. Show that refresh recovery is unavailable. Do not claim persistence succeeded. |
| Cancel during completion / cleanup offline | Reconcile server outcome. Completed originals are not deleted by “cancel unfinished”. Keep cleanup pending until confirmed; reservations cannot be claimed released prematurely. |
| Old abandoned jobs | Quiet attention/history, explicit cancel cleanup and documented expiry. Hiding does not delete originals or release reservations. Do not silently remove existing user records. |
| Accessibility / phone keyboard / long names | Keyboard-operable controls, visible focus, screen-reader state changes without percentage spam, large touch targets, safe-area spacing and no horizontal overflow. Closing returns focus to the upload control. |

## Baseline and design choices

Use familiar upload patterns rather than copying another product's decoration: direct file/folder selection, captured destination, compact progress and explicit recovery. Google Drive documents direct and drag/drop uploads and resumable transfer reconciliation; Dropbox distinguishes browser uploads from its desktop route for very large files. These references inform the baseline, not a claim that their entire current interfaces were audited. [Drive upload help](https://support.google.com/drive/answer/2424368), [Drive resumable protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Dropbox upload options](https://help.dropbox.com/create-upload/add-files).

Choose the compact status control plus optional side panel over a permanently expanded bottom tray: it frees the media canvas and makes the same Uploads destination work on phones. A full Uploads page handles long queues; the side panel handles quick inspection. Avoid putting unrelated downloads inside a section labelled Uploads; preserve existing download controls separately or deliberately name a combined centre Transfers.

## Delivery order and acceptance

- [x] Source-level assessment and end-to-end proposed contract.
- [x] Separate interactive demonstration with simulated data: compact status, hide/reopen, navigation with captured destinations, pause/resume, offline recovery, quiet return, source access fallback, mixed outcome and completion.
- [ ] Implement presentation and explicit job states without altering existing multipart identity/access rules.
- [ ] Move upload ownership above internal routes; convert relevant full-document navigation; test account and paired-device paths.
- [ ] Add authoritative recovery/status reconciliation, batch source matching and single-tab ownership.
- [ ] Add capability-based persistent sources with bounded storage, privacy cleanup and honest recovery labels.
- [ ] Verify real transfers and deploy a schema-compatible increment. Keep unreleased main-only backend features gated.
- [ ] Physical iPhone/desktop acceptance, including low storage, cloud-backed picker media, foreground/background transitions and large batches.

Acceptance requires more than a visual check: seed interrupted manifests and confirm login stays unobstructed; transfer real bytes while navigating every internal route; pause a queued item immediately; inject offline/401/403/429/5xx and lost completion responses; exercise two tabs; verify hashes after recovery; simulate storage denial; test cancel/complete races and changed destinations; confirm thumbnails and feed failures never invalidate delivered originals. Run Chromium, Firefox and WebKit responsive/keyboard coverage. Record real-device limits separately.

The prototype is a deterministic interaction demonstration, not an upload implementation or performance benchmark. It makes no requests and does not read local media. See `prototypes/relay-upload-workflow/README.md` for controls and validation.
