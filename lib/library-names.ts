// Keep extensions intact when editing display names or numbering a batch.
export function splitFilename(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: "" };
}

export function numberedFilename(stem: string, index: number, extension: string) {
  return `${stem.trim()} — ${String(index).padStart(3, "0")}${extension}`;
}

export function validFilename(name: string) {
  return name.length > 0 && name.length <= 240 && name.trim() === name && !/[\u0000-\u001f\u007f/\\:*?"<>|]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

// Capture dates are wall-clock camera values, not invented UTC instants.
export function validCaptureDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value && value >= "1800";
}
