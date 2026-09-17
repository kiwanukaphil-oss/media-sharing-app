export type Category = "original" | "final";
export type MediaItem = {
  id: string; name: string; mime: string; size: number; sha256: string;
  category: Category; createdAt: number; deviceName: string;
};
export type Device = { id: string; name: string; createdAt: number; current: boolean };
export type Session = { space: { id: string; name: string }; deviceId: string; transport: "local" | "direct" | "unconfigured" };
export type UploadSession = { id: string; partSize: number; status: string };
export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024;
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
