"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Confirmation = { title: string; description: string; action: string; destructive?: boolean };

// Resolve exactly once, including cancellation/unmount, so a dismissed prompt can never execute an action later.
export function useActionConfirmation() {
  const [pending, setPending] = useState<Confirmation | null>(null);
  const resolve = useRef<((approved: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => { resolve.current?.(false); }, []);
  useEffect(() => { if (!pending) { opener.current?.focus(); opener.current = null; } }, [pending]);
  const confirm = useCallback((details: Confirmation) => new Promise<boolean>(finish => {
    resolve.current?.(false);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    resolve.current = finish;
    setPending(details);
  }), []);
  const settle = useCallback((approved: boolean) => {
    resolve.current?.(approved); resolve.current = null; setPending(null);
  }, []);
  return { confirm, confirmation: pending && <ActionConfirmation details={pending} settle={settle} /> };
}

// The safe action receives initial focus; Escape and the close event always mean cancel.
function ActionConfirmation({ details, settle }: { details: Confirmation; settle: (approved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="modal action-confirmation" aria-labelledby={title} aria-describedby={description} onCancel={event => { event.preventDefault(); settle(false); }} onClose={() => settle(false)}>
    <div className={`confirmation-symbol${details.destructive ? " is-danger" : ""}`}><AlertTriangle size={22} /></div>
    <h2 id={title}>{details.title}</h2><p id={description}>{details.description}</p>
    <div className="confirmation-actions"><button autoFocus className="button secondary" onClick={() => settle(false)}>Cancel</button><button className={`button ${details.destructive ? "danger-solid" : "primary"}`} onClick={() => settle(true)}>{details.action}</button></div>
  </dialog>;
}
