# Relay — Afterlight concept

A separate, high-fidelity HTML concept for a darker, cinematic and editorial Relay theme. It does not call Relay APIs, read the live library or modify production application code.

## Direction

- **Mood:** quiet, cinematic and intimate rather than bright and utility-led.
- **Palette:** near-black ink, warm paper, muted sage and a restrained coral action colour.
- **Typography:** large editorial serif display type paired with compact system sans-serif controls.
- **Layout:** an image-led story feature, asymmetric cards and a dense discovery gallery.
- **Interaction:** calm fades, small lifts and restrained image scaling, with reduced-motion support.

All photography, icons, CSS and JavaScript are stored locally. No package install, external font or network request is required.

## Open

From the repository root:

```powershell
python -m http.server 4320 --bind 127.0.0.1 --directory prototypes/relay-cinematic
```

Then visit **http://127.0.0.1:4320/**.

## Review route

1. Open the featured story and browse the immersive viewer with the arrow keys.
2. Toggle the photograph details and appreciate a story.
3. Open **Discover**, try the search field and switch its category pills.
4. Review **Collections** and the sample profile from the account menu or mobile navigation.
5. Open **Share work** to inspect the upload state and simulated file selection.
6. Open **Activity** and the account menu.
7. Narrow the viewport to inspect the mobile shell, bottom navigation, gallery and viewer.

## Scope

This is a visual direction mockup, not a production redesign. Interactions are intentionally simulated and reset on reload. Existing Relay permissions, original-file guarantees, private/shared space boundaries, transfer recovery, filtering and account workflows remain production requirements if this direction is adopted.

The three coastal photographs were generated specifically for this concept using the built-in image-generation workflow. The six interior photographs are the local illustrative assets already used by the earlier Relay design prototype. The local icon sprite comes from `lucide-react`; its licence is retained in `assets/LUCIDE-LICENSE`.
