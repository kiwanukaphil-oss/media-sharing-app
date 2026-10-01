# Relay upload workflow study

Open `index.html` in a browser. This is an isolated, deterministic prototype; it makes no network requests, reads no local originals, and changes no application data.

Open **Coast weekend**, then **Add sample files**. Browse another album, workspace or Account; the compact Uploads control remains available and each upload retains its captured destination. **Advance demo** advances simulated byte progress. On desktop, the control opens a dismissible non-modal panel; on a phone it opens the Uploads screen with a Back action.

The scenario selector exercises connection loss, quiet restoration with one deliberate pause, renewable file permission, genuinely missing originals, partial success and completion. Recovery buttons explicitly simulate permission, file matching or storage resolution. Cancel unfinished requires a separate choice and preserves uploaded originals. Clearing history also preserves originals.

No actual file picker, persistence, server reconciliation, throughput estimate, multi-tab coordination, upload engine or browser-background guarantee is implemented here. Those requirements and acceptance checks are in [the assessment](../../docs/UPLOAD-WORKFLOW-REVIEW.md).

Run `node prototypes/relay-upload-workflow/verify.mjs` from the repository root for isolated Chromium/Firefox/WebKit interaction and responsive checks. Screenshots are written to the ignored `outputs/upload-workflow/` directory. This validates the demonstration, not the proposed production architecture.

Validation on 1 October 2026: all three engines passed the interaction suite at 320, 390, 600, 736, 1024 and 1440 pixels with no page exceptions or horizontal overflow. Desktop and phone screenshots were visually inspected. Production code and real-device acceptance are unchanged.
