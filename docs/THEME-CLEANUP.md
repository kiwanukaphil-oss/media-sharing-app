# Interaction theme cleanup - 25 September 2026

The purple search ring came from the global `input:focus-visible` rule inherited from the earlier theme. A final shared `theme-controls.css` layer provides named Relay palette tokens and current controls without deleting historical presentation styles, which remain retirement candidates.

Search focus now outlines the complete search field in olive, including its icon. Text inputs and textareas retain a visible focus border and ring. The cleanup also covers grid/list controls, filters, selection borders and actions, confirmation icons, form/table surfaces, transfer details, neutral viewer controls, and smaller inherited details. Intentional Plum/Blue album-cover choices and semantic error/warning colours remain available.

## Verification

- [x] Rendered-colour audit of album creation, home/search, dropdown, mobile gallery and dark viewer: no violet remnants in checked states, apart from the deliberate Plum cover swatch. Local screenshots inspected.
- [x] Album workflow and computed focus/field/viewer colour checks pass Chromium, Firefox and WebKit. Section CRUD/moves and presentation/retrieval checks pass. Existing view preferences remain covered.
- [x] Final three-engine focus assertions, lint, production build and deployment dry run pass. Published source `3037f5a` as Worker `7db6a8ad-4476-49b1-9df8-ef794b540e09` at 100%. Both-origin production probes pass; signed-in live Find an album focus is visibly olive around the complete field.
- [ ] Hosted follow-up [36107692935](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/36107692935) is running at this record update.

No backend, data or schema changes. Production stays on schema 0020.
