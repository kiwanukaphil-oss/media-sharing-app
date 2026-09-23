# Relay app-refresh prototype

A high-fidelity HTML concept that keeps Relay recognisably an application: persistent side navigation, workspace context, visible filters, sorting, grid/list views, album navigation, storage status, selection tools and a focused media viewer.

The theme adds presence without replacing the product structure:

- midnight-indigo navigation with clearer active states;
- a warm lilac-neutral canvas rather than document-white pages;
- coral, periwinkle and gold accents tied to actions and status;
- elevated tool surfaces and more substantial media cards;
- a compact workspace overview for useful visual rhythm;
- stronger hierarchy and more tactile hover, selection and progress states.

## Open

From the repository root:

```powershell
python -m http.server 4321 --bind 127.0.0.1 --directory prototypes/relay-app-refresh
```

Then visit **http://127.0.0.1:4321/**.

All assets are local. The mockup does not call Relay APIs or read the live workspace.

## Review route

1. Compare the persistent sidebar, workspace switcher, storage status and album navigation with the current app.
2. Use the visible type/date filters, search, sorting and grid/list controls.
3. Select files to inspect the contextual action bar, album action and reversible Trash state.
4. Open a photograph to review the immersive viewer, details drawer, filmstrip, zoom and keyboard navigation.
5. Try the sample upload, device and album-creation dialogs.
6. Narrow the browser to verify the responsive navigation drawer, horizontal overview and two-column gallery.

## Scope

This is a design prototype. Sample content and actions reset on reload. Production adoption must retain Relay’s existing API, permission, transfer recovery, filtering, deep-link, original-download and private/shared workspace behaviours.

Photography remains illustrative local imagery. The icon sprite comes from `lucide-react`; its licence is retained in `assets/LUCIDE-LICENSE`.
