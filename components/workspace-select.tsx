"use client";

import { useRef, useState } from "react";
import { Select } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = { value: string; label: string; group?: string };
type Props = { label: string; value: string; onChange: (value: string) => void; options: Option[]; disabled?: boolean };
const emptyValue = "__relay_empty__";

// Radix supplies typeahead, arrow navigation and focus return; dialog-local portals stay in the native modal's top layer.
export function WorkspaceSelect({ label, value, onChange, options, disabled }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const groups = Array.from(new Set(options.map(option => option.group || "")));
  return <Select.Root value={value || emptyValue} onValueChange={next => onChange(next === emptyValue ? "" : next)} disabled={disabled} onOpenChange={open => { if (open) setContainer(trigger.current?.closest("dialog") || undefined); }}>
    <Select.Trigger ref={trigger} className="workspace-select" aria-label={label} data-value={value}>
      <Select.Value /><Select.Icon><ChevronDown size={15} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="workspace-select-menu" position="popper" sideOffset={6} collisionPadding={12}>
        <Select.ScrollUpButton className="select-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
        <Select.Viewport className="select-viewport">{groups.map(group => <Select.Group key={group}>
          {group && <Select.Label className="select-group-label">{group}</Select.Label>}
          {options.filter(option => (option.group || "") === group).map(option => <Select.Item key={option.value} value={option.value || emptyValue} textValue={option.label} className="workspace-option" data-value={option.value}>
            <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={15} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Group>)}</Select.Viewport>
        <Select.ScrollDownButton className="select-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
