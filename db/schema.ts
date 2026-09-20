import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, primaryKey, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Short-lived login attempts are separate from identities and never grant space access.
export const authTransactions = sqliteTable("auth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  configurationHash: text("configuration_hash").notNull(),
  nonce: text("nonce").notNull(),
  verifier: text("verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_auth_transactions_expiry").on(table.expiresAt)]);
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

export const albumSections = sqliteTable("album_sections", {
  albumId: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  coverMediaId: text("cover_media_id"),
  deletedAt: integer("deleted_at"),
}, table => [primaryKey({ columns: [table.albumId, table.id] }), uniqueIndex("idx_section_active_name").on(table.albumId, sql`lower(${table.name})`).where(sql`${table.deletedAt} IS NULL`)]);

export const albumMedia = sqliteTable("album_media", {
  albumId: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  sectionId: text("section_id"),
}, table => [primaryKey({ columns: [table.albumId, table.mediaId] }), index("idx_album_media_file").on(table.mediaId), foreignKey({ columns: [table.albumId, table.sectionId], foreignColumns: [albumSections.albumId, albumSections.id] })]);
