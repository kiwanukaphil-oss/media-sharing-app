"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { Check, Minus } from "lucide-react";

type Props = { label: string; checked: boolean; mixed?: boolean; disabled?: boolean; className?: string; onToggle: (shift: boolean) => void };

// Keep native checkbox semantics and Shift-click while drawing a quiet, consistent selection mark.
export function SelectionControl({ label, checked, mixed = false, disabled, className = "", onToggle }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className={`selection-control ${className}`} title={label}>
    <input ref={input} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={() => {}} onClick={(event: MouseEvent<HTMLInputElement>) => onToggle(event.shiftKey)} />
    <span className="selection-mark" aria-hidden="true">{mixed ? <Minus size={12} strokeWidth={2} /> : <Check size={12} strokeWidth={2} />}</span>
  </label>;
}
