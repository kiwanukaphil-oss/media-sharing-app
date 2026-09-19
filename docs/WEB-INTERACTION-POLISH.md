# Web interaction refinement

Implemented on 2026-09-19 after approval to refine dropdowns, selection, item actions, confirmations and recovery. Deployed after separate user approval as version `178f6f01-879f-4d50-90d6-fb3c06913dd5`, with Cloudflare allocation read back at 100%.

## Controls and workflows

- Library sort, location, date mode and album destination use a shared styled listbox built on the installed Radix Select primitive. Options support keyboard navigation, typeahead, selected-state indicators, scrolling, viewport collision handling, Escape and focus return. Menus opened inside native dialogs stay in the dialog layer.
- Small selection checkboxes sit beside filenames, leaving photographs unobscured. The checkbox above the gallery supports unchecked, partial and checked states. Selection stays bounded to the first 100 loaded files; its accessible name and tooltip identify the loaded count. Existing Shift-click range selection remains available.
- Download, rename and Trash icons are visible on every applicable file. Trash items expose Restore and permanent Delete. Members see download; owner-only actions remain protected by the server.
- A compact icon bar appears only for the current selection. Album destination opens in a focused dialog. Bulk rename retains its complete filename preview and conflict handling.
- Single-file Trash and Restore now use the existing revision-checked organisation endpoint, making them immediately undoable without overwriting newer edits. Shared feedback offers Undo until dismissed or replaced by a subsequent action; it stays visible when scrolling and avoids the selection/transfer panels.
- Removing an album is immediate and undoable; media stays in All files. Confirmation remains for permanent deletion, access changes, upload cancellation and upload restart. These use styled, named dialogs with explicit consequences, safe initial focus, Escape cancellation and focus restoration.

Existing date-hint softening, upload destination retention, download bytes, archive rules, original-name search, camera dates, deep links, permission enforcement and last-owner protection are preserved. No API/schema/native-app changes or new dependencies were introduced. Legacy card-disclosure support and CSS remain marked as removal candidates.

## Verification

TypeScript, zero-warning web lint, production build and the full isolated API integration suite passed. Chrome, Edge, Firefox and WebKit passed file and library workflows. Browser coverage exercises direct file actions and Undo, permanent-delete cancellation/focus restoration, owner promotion/self-disconnection, select-all partial state, listbox keyboard interaction, dialog-local destination selection and album removal/Undo, alongside the existing transfer, media, permissions and library regressions. Responsive coverage includes 320, 390 and 768 pixel layouts. Existing framework build notices remain.

Desktop and narrow-screen layouts were visually reviewed with sample photographs in the isolated local preview at http://127.0.0.1:8793/. This workspace is disposable and separate from production. No commit or push was performed.

## Production release

The tested build was deployed after a successful direct-config dry run, preserving existing secrets, bindings and schema. The prior version `6f662a34-05b1-4cf2-9f5e-ad4a54353698` remains the code-only rollback target. Public entry, security headers, database/storage readiness and private-feed protection passed after deployment. Private release logs are under `.sites-runtime/design-release/interaction-*`.

Hosted checks passed in the isolated Relay verification space: styled dropdowns, visible item actions, select-all, bulk Trash/Undo, permanent-delete cancellation and focus return, the viewer, original image uploads/thumbnails, verified streaming save, Firefox attachment downloads, and responsive layout. Album upload, rename, original-name search, capture-date filtering and deep-link reload passed. The cross-session multipart transfer check also passed with matching original bytes, CORS and receiver revocation. Small named fixtures and the multipart original remain in the verification space as cleanup candidates. Existing user media was not changed.

Primitive reference: [Radix Select](https://www.radix-ui.com/primitives/docs/components/select).
