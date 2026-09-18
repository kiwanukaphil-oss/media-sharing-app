import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, table => [index("idx_devices_space").on(table.spaceId)]);
export const invitations = sqliteTable("invitations", {
  tokenHash: text("token_hash").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  createdBy: text("created_by").references(() => devices.id),
  expiresAt: integer("expires_at").notNull(),
  redeemedAt: integer("redeemed_at"),
});
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  originalName: text("original_name"),
  capturedAt: text("captured_at"),
  uploadBatch: text("upload_batch"),
  revision: integer("revision").notNull().default(0),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  category: text("category", { enum: ["original", "final"] }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  uploadId: text("upload_id").notNull(),
  partSize: integer("part_size").notNull(),
  status: text("status", { enum: ["uploading", "ready", "deleting", "cancelling"] }).notNull(),
  archivedAt: integer("archived_at"),
  previewReady: integer("preview_ready").notNull().default(0),
  previewSize: integer("preview_size").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, table => [index("idx_media_space_status_created").on(table.spaceId, table.status, table.createdAt), index("idx_media_feed").on(table.spaceId, table.status, table.archivedAt, table.createdAt, table.id)]);

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
  deletedAt: integer("deleted_at"),
  revision: integer("revision").notNull().default(0),
}, table => [index("idx_albums_space").on(table.spaceId, table.deletedAt, table.archivedAt)]);

export const albumMedia = sqliteTable("album_media", {
  albumId: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
}, table => [primaryKey({ columns: [table.albumId, table.mediaId] }), index("idx_album_media_file").on(table.mediaId)]);
