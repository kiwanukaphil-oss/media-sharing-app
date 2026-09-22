// The opaque file directory prevents collisions without changing the recorded original/name fields.
// Strip path/control characters only in the suggested portable path, never in the source metadata.
export function portableFilePath(id: string, name: string) {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "original";
  return `files/${id}/${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe}`;
}

