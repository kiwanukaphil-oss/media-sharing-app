import { MAX_FILE_SIZE } from "./contracts";

export type FolderImportSource = { name: string; size: number; webkitRelativePath?: string };
export type FolderImportPlan = { albumName: string; sections: { key: string; name: string; count: number }[];
  files: { index: number; sectionKey: string | null }[]; totalBytes: number; duplicateNames: number; flattened: boolean };

// Read metadata only: the preview never reads or uploads original bytes. Keep folder paths as plain
// labels in one section level and reject traversal/oversized selections before any server mutation.
export function planFolderImport(files: FolderImportSource[]): FolderImportPlan {
  if (!files.length || files.length > 200) throw new Error("Choose between 1 and 200 files for one folder import.");
  const sections = new Map<string, { key: string; name: string; count: number }>();
  const names = new Set<string>(), roots = new Set<string>();
  let totalBytes = 0, duplicateNames = 0, flattened = false;
  const entries = files.map((file, index) => {
    if (!file.size || file.size > MAX_FILE_SIZE) throw new Error(`${file.name}: choose a file between 1 byte and 100 GB.`);
    const path = file.webkitRelativePath || file.name, parts = path.split("/");
    if (path.length > 4096 || parts.some(part => !part || part === "." || part === ".." || /[\u0000-\u001f\\]/.test(part))) throw new Error("This folder contains an unsupported path. Choose its files directly.");
    if (parts.length > 1) roots.add(parts[0]);
    const key = parts.length > 2 ? parts.slice(1, -1).join("/") : null;
    if (key) {
      const existing = sections.get(key);
      if (existing) existing.count++;
      else sections.set(key, { key, name: key.split("/").join(" / ").slice(0, 100), count: 1 });
    }
    if (parts.length > 3) flattened = true;
    const name = file.name.toLocaleLowerCase("en");
    if (names.has(name)) duplicateNames++; names.add(name); totalBytes += file.size;
    return { index, sectionKey: key };
  });
  if (roots.size > 1 || sections.size > 50) throw new Error("Choose one folder with at most 50 section groups. Import larger collections in smaller parts.");
  return { albumName: ([...roots][0] || "Imported files").slice(0, 100), sections: [...sections.values()], files: entries, totalBytes, duplicateNames, flattened };
}
