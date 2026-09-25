"use client";

import { useEffect, useRef, useState } from "react";
import { Check, List, X } from "lucide-react";
import type { AlbumSection } from "@/lib/contracts";

// Visible filter buttons keep album structure discoverable; the directory handles long section lists.
export function SectionNavigation({ sections, count, value, onChange }: {
  sections: AlbumSection[]; count: number; value: string; onChange: (value: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [moreRight, setMoreRight] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const unsectioned = Math.max(0, count - sections.reduce((sum, section) => sum + section.count, 0));
  const choices = [{ id: "", name: "All photos", count }, ...sections,
    ...(unsectioned > 0 || value === "unsectioned" ? [{ id: "unsectioned", name: "Unsectioned", count: unsectioned }] : [])];

  // Observe available width and content changes rather than assuming a section-count breakpoint.
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 2);
      setMoreRight(element.scrollWidth - element.clientWidth - element.scrollLeft > 2);
    };
    const observer = new ResizeObserver(() => {
      const selected = element.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (selected) {
        const bounds = element.getBoundingClientRect(), selectedBounds = selected.getBoundingClientRect();
        if (selectedBounds.right > bounds.right) element.scrollLeft += selectedBounds.right - bounds.right + 3;
        else if (selectedBounds.left < bounds.left) element.scrollLeft -= bounds.left - selectedBounds.left + 3;
      }
      measure();
    });
    observer.observe(element);
    Array.from(element.children).forEach(child => observer.observe(child));
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [sections, count]);

  useEffect(() => {
    rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  useEffect(() => {
    if (!directoryOpen) return;
    const element = dialog.current, trigger = directoryTrigger.current;
    element?.showModal();
    return () => { element?.close(); trigger?.focus({ preventScroll: true }); };
  }, [directoryOpen]);

  return <div className="section-browser">
    <div className={`section-tab-viewport${moreRight ? " has-more-sections" : ""}`}>
      <div ref={rail} className="section-tabs" role="group" aria-label="Album section" data-value={value}>
        {choices.map(choice => <button key={choice.id} type="button" className="section-tab" data-value={choice.id} aria-pressed={value === choice.id} title={`${choice.name} (${choice.count})`} onClick={() => onChange(choice.id)}><span>{choice.name}</span><small>{choice.count}</small></button>)}
      </div>
    </div>
    {overflow && <button ref={directoryTrigger} className="section-directory-trigger" onClick={() => setDirectoryOpen(true)}><List size={14} />View all sections · {sections.length}</button>}
    {directoryOpen && <dialog ref={dialog} className="modal section-directory" aria-label="All album sections" onCancel={event => { event.preventDefault(); setDirectoryOpen(false); }} onClose={() => setDirectoryOpen(false)}>
      <div className="modal-heading"><h2>Album sections</h2><button className="icon-button" aria-label="Close section list" onClick={() => setDirectoryOpen(false)}><X size={20} /></button></div>
      <div className="section-directory-list">{choices.map(choice => <button key={choice.id} className="placement-choice" aria-pressed={value === choice.id} onClick={() => { onChange(choice.id); setDirectoryOpen(false); }}><span>{choice.name}</span><small>{choice.count}</small>{value === choice.id && <Check size={17} />}</button>)}</div>
    </dialog>}
  </div>;
}
