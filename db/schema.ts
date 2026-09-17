import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, table => [index("idx_devices_space").on(table.spaceId)]);
export const invitations = sqliteTable("invitations", {
  tokenHash: text("token_hash").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  expiresAt: integer("expires_at").notNull(),
  redeemedAt: integer("redeemed_at"),
});
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  category: text("category", { enum: ["original", "final"] }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  uploadId: text("upload_id").notNull(),
  partSize: integer("part_size").notNull(),
  status: text("status", { enum: ["uploading", "ready"] }).notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("idx_media_space_status_created").on(table.spaceId, table.status, table.createdAt)]);
