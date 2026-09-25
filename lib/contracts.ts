export type Category = "original" | "final";
export type MediaItem = {
  sectionId?: string | null; sectionName?: string | null;
  accessScopeId?: string | null; id: string; name: string; mime: string; size: number; sha256: string;
  category: Category; createdAt: number; deviceName: string;
  isFavorite?: boolean; canEdit?: boolean; hasPreview?: boolean; archivedAt?: number | null;
  originalName?: string; capturedAt?: string | null; uploadBatch?: string | null; revision?: number;
};
export type Album = { accessScopeId?: string | null; id: string; name: string; description: string; createdAt: number; latestUploadAt?: number; archivedAt: number | null; deletedAt: number | null; revision: number; count: number };
export type AlbumSection = { id: string; albumId: string; name: string; position: number; count: number; coverMediaId?: string | null };
export type RenameEntry = { id: string; name: string; expectedRevision: number };
export type FeedPage = { items: MediaItem[]; nextCursor: string | null; counts: { all: number; original: number; final: number; trash: number }; total: number; role: LibraryRole };
export type StorageUsage = { pooled?: boolean; poolUsed?: number; allScopeBilling?: boolean | number; used: number; reserved: number; trash: number; limit: number; uploads: { id: string; name: string; size: number; createdAt: number; deviceName: string; canCancel: boolean; publication?: boolean }[] };
export type DeviceRole = "owner" | "member";
export type LibraryRole = DeviceRole | "editor" | "viewer" | "contributor";
export function libraryRoleLabel(role: string) { return role === "owner" ? "Owner" : role === "editor" ? "Editor" : role === "viewer" ? "Viewer" : role === "contributor" ? "Contributor" : role === "member" ? "Member" : "Unavailable"; }
// Reuse concise capability language in issuer and recipient previews. Unknown roles never imply access.
export function libraryRoleDescription(role: string) {
  switch (role) {
    case "owner": return "View, save and organise accessible files; manage access and permanent deletion.";
    case "editor": return "View, save, upload and organise files and albums within your audiences; no access administration or permanent deletion.";
    case "contributor": return "View, save and upload files; edit and restore your own contributions, including earlier contributions attributable to this membership.";
    case "viewer": return "View and save originals; no uploads or changes.";
    case "member": return "View, save and upload files; no editing of completed shared files.";
    default: return "Access is unavailable. Refresh to review the current role.";
  }
}
export type Device = { id: string; name: string; createdAt: number; current: boolean; role: DeviceRole };
export type Session = { uploadRequests?: boolean; deliveries?: boolean; restrictedScopes?: boolean; space: { id: string; name: string; kind?: "personal" | "shared" }; deviceId: string; role: LibraryRole; transport: "local" | "direct" | "unconfigured"; authentication?: "account"; personId?: string };
export type UploadSession = { id: string; partSize: number; status: string; uploadId?: string };
export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024;
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
