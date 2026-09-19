export type Category = "original" | "final";
export type MediaItem = {
  id: string; name: string; mime: string; size: number; sha256: string;
  category: Category; createdAt: number; deviceName: string;
  hasPreview?: boolean; archivedAt?: number | null;
  originalName?: string; capturedAt?: string | null; uploadBatch?: string | null; revision?: number;
};
export type Album = { id: string; name: string; description: string; createdAt: number; archivedAt: number | null; deletedAt: number | null; revision: number; count: number };
export type AlbumSection = { id: string; albumId: string; name: string; position: number; count: number; coverMediaId?: string | null };
export type RenameEntry = { id: string; name: string; expectedRevision: number };
export type FeedPage = { items: MediaItem[]; nextCursor: string | null; counts: { all: number; original: number; final: number; trash: number }; total: number; role: DeviceRole };
export type StorageUsage = { used: number; reserved: number; trash: number; limit: number; uploads: { id: string; name: string; size: number; createdAt: number; deviceName: string; canCancel: boolean }[] };
export type DeviceRole = "owner" | "member";
export type Device = { id: string; name: string; createdAt: number; current: boolean; role: DeviceRole };
export type Session = { space: { id: string; name: string }; deviceId: string; role: DeviceRole; transport: "local" | "direct" | "unconfigured" };
export type UploadSession = { id: string; partSize: number; status: string; uploadId?: string };
export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024;
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
