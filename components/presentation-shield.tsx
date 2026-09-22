"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const PresentationContext = createContext<(() => void) | null>(null);
const storageKey = "relay-presentation-hidden";

export function HideLibraryButton() {
  const hide = useContext(PresentationContext);
  return <button className="icon-button" aria-label="Hide library for screen sharing" title="Hide library for screen sharing" onClick={() => hide?.()}><EyeOff size={18} /></button>;
}

// Keep the workspace mounted so hiding never cancels a transfer. Conceal before reading this tab's
// preference to prevent a reload flash; only a boolean is stored, never library names or file data.
export function PresentationShield({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"checking" | "visible" | "hidden">("checking");
  const [remembered, setRemembered] = useState(true);
  const opener = useRef<HTMLElement | null>(null);
  const revealButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let hidden = false;
    try { hidden = sessionStorage.getItem(storageKey) === "true"; } catch { /* Still usable without storage. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration must not expose a previously concealed library.
    setMode(hidden ? "hidden" : "visible");
  }, []);
  useEffect(() => {
    if (mode === "hidden") revealButton.current?.focus();
    if (mode === "visible" && opener.current) { opener.current.focus(); opener.current = null; }
  }, [mode]);
  function hideLibrary() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { sessionStorage.setItem(storageKey, "true"); setRemembered(true); } catch { setRemembered(false); }
    setMode("hidden");
  }
  function revealLibrary() {
    try { sessionStorage.removeItem(storageKey); } catch { /* Explicit reveal works even with blocked storage. */ }
    setMode("visible");
  }
  return <PresentationContext.Provider value={hideLibrary}>
    {mode !== "visible" && <main className="presentation-shield" aria-label="Presentation privacy">
      <div className="presentation-shield-card"><span className="presentation-shield-symbol"><EyeOff size={28} strokeWidth={1.5} /></span>
        <p className="eyebrow">RELAY</p><h1>{mode === "checking" ? "Opening your workspace" : "Library hidden"}</h1>
        {mode === "hidden" && <><p>Page content is hidden for screen sharing. Transfers can continue in this tab.</p>
          <button ref={revealButton} className="button primary" onClick={revealLibrary}><Eye size={18} />Show library</button>
          <p className="small-muted">This covers the library page, not your browser address bar, other tabs or access to your files.</p>
          {!remembered && <p role="status" className="small-muted">Browser storage is unavailable. Reloading will show the library again.</p>}</>}
      </div>
    </main>}
    <div style={mode === "visible" ? undefined : { display: "none" }} inert={mode !== "visible"}>{children}</div>
  </PresentationContext.Provider>;
}
