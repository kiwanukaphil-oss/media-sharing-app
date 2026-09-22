import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, primaryKey, foreignKey, uniqueIndex, check } from "drizzle-orm/sqlite-core";

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Provider identity is unique; email is deliberately not an account-linking key.
export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  displayName: text("display_name").notNull(),
  verifiedEmail: text("verified_email").notNull(),
  createdAt: integer("created_at").notNull(),
  disabledAt: integer("disabled_at"),
  credentialsChangedAt: integer("credentials_changed_at").notNull().default(0),
}, table => [uniqueIndex("idx_people_provider_identity").on(table.issuer, table.subject)]);

// Keep a monotonic recovery watermark even when a reset precedes the first Relay sign-in.
export const recoveryWatermarks = sqliteTable("recovery_watermarks", {
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  changedAt: integer("changed_at").notNull(),
}, table => [primaryKey({ columns: [table.issuer, table.subject] })]);

// Requests are auditable intent, never permission for an unattended destructive cleanup job.
export const accountDeletionRequests = sqliteTable("account_deletion_requests", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => people.id),
  requestedAt: integer("requested_at").notNull(),
  status: text("status").notNull().default("pending"),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("idx_account_deletion_person").on(table.personId),
  uniqueIndex("idx_account_deletion_pending").on(table.personId).where(sql`${table.status} IN ('pending', 'review_required')`)]);

// Account credentials cannot be used as legacy device credentials or grant space access.
export const accountSessions = sqliteTable("account_sessions", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => people.id),
  tokenHash: text("token_hash").notNull().unique(),
  configurationHash: text("configuration_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  sessionMode: text("session_mode", { enum: ["temporary", "trusted"] }).notNull().default("trusted"),
  providerSessionId: text("provider_session_id"),
  authenticatedAt: integer("authenticated_at").notNull().default(0),
}, table => [index("idx_account_sessions_person").on(table.personId)]);

// Short-lived login attempts are separate from identities and never grant space access.
export const authTransactions = sqliteTable("auth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  configurationHash: text("configuration_hash").notNull(),
  nonce: text("nonce").notNull(),
  verifier: text("verifier").notNull(),
  sessionMode: text("session_mode", { enum: ["temporary", "trusted"] }).notNull().default("temporary"),
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

// Membership is independent of device authority; revoked memberships cannot be silently reclaimed.
export const spaceMemberships = sqliteTable("space_memberships", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => people.id),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
  revision: integer("revision").notNull().default(0),
}, table => [uniqueIndex("idx_memberships_person_space").on(table.personId, table.spaceId), index("idx_memberships_space").on(table.spaceId)]);

// Membership invitations are explicit, email-bound and separate from legacy device pairing.
export const personInvitations = sqliteTable("person_invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  createdBy: text("created_by").notNull().references(() => spaceMemberships.id),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  acceptedAt: integer("accepted_at"),
  acceptedBy: text("accepted_by").references(() => people.id),
  acceptedOperation: text("accepted_operation"),
}, table => [index("idx_person_invitations_space").on(table.spaceId)]);

// Durable evidence ties each membership mutation to an authenticated actor and expected revision.
export const membershipEvents = sqliteTable("membership_events", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  actorId: text("actor_id").notNull().references(() => people.id),
  membershipId: text("membership_id").notNull().references(() => spaceMemberships.id),
  action: text("action").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("idx_membership_events_space").on(table.spaceId)]);

// Source identifiers are historical references, not cascading FKs: source deletion cannot recall a published copy.
export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  sourceSpaceId: text("source_space_id").notNull().references(() => spaces.id),
  destinationSpaceId: text("destination_space_id").notNull().references(() => spaces.id),
  personId: text("person_id").notNull().references(() => people.id),
  sourceRevision: integer("source_revision").notNull(),
  albumId: text("album_id"),
  sectionId: text("section_id"),
  createdAt: integer("created_at").notNull(),
  phase: text("phase").notNull().default("pending"),
  attemptKey: text("attempt_key"),
  leaseExpiresAt: integer("lease_expires_at").notNull().default(0),
}, table => [index("idx_publications_person").on(table.personId)]);

// Retain every attempt key so interrupted/cancelled storage can be reconciled without guessing object prefixes.
export const publicationAttempts = sqliteTable("publication_attempts", {
  objectKey: text("object_key").primaryKey(),
  publicationId: text("publication_id").notNull().references(() => publications.id),
  createdAt: integer("created_at").notNull(),
}, table => [index("idx_publication_attempts_job").on(table.publicationId)]);

// Non-authenticating compatibility actors preserve media attribution across account sessions.
export const accountSpaceActors = sqliteTable("account_space_actors", {
  membershipId: text("membership_id").primaryKey().references(() => spaceMemberships.id),
  deviceId: text("device_id").notNull().unique().references(() => devices.id),
});

// Existing spaces remain shared; only explicitly allocated personal spaces receive this record.
export const personalSpaces = sqliteTable("personal_spaces", {
  spaceId: text("space_id").primaryKey().references(() => spaces.id),
  personId: text("person_id").notNull().unique().references(() => people.id),
  quotaBytes: integer("quota_bytes").notNull(),
});

export const ownerClaimAttempts = sqliteTable("owner_claim_attempts", {
  tokenHash: text("token_hash").primaryKey(),
  sessionId: text("session_id").notNull().references(() => accountSessions.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
}, table => [index("idx_claim_attempts_expiry").on(table.expiresAt)]);

// Immutable claim evidence prevents one legacy credential linking itself to several people.
export const legacyOwnerClaims = sqliteTable("legacy_owner_claims", {
  deviceId: text("device_id").primaryKey().references(() => devices.id),
  membershipId: text("membership_id").notNull().references(() => spaceMemberships.id),
  sessionId: text("session_id").notNull().references(() => accountSessions.id),
  claimedAt: integer("claimed_at").notNull(),
});
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
  status: text("status", { enum: ["uploading", "publishing", "ready", "deleting", "cancelling"] }).notNull(),
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

// Initial activation permits global backup coordination only. Application closure tracking stays off
// until account/device/storage disposition and minimisation have their separate execution review.
export const closureFences = sqliteTable("closure_fences", {
  id: text("id").primaryKey().notNull(),
  personId: text("person_id").notNull().unique().references(() => people.id),
  requestId: text("request_id").notNull().unique().references(() => accountDeletionRequests.id),
  sourceRevision: integer("source_revision").notNull(),
  generation: integer("generation").notNull(),
  phase: text("phase", { enum: ["draining", "review_required"] }).notNull(),
  planDigest: text("plan_digest").notNull(),
  decisionDigest: text("decision_digest").notNull(),
  approvalDigest: text("approval_digest").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [check("closure_fence_generation", sql`${table.generation} > 0`),
  check("closure_fence_phase", sql`${table.phase} IN ('draining','review_required')`)]);

export const closureWriteAdmissions = sqliteTable("closure_write_admissions", {
  id: text("id").primaryKey().notNull(),
  kind: text("kind", { enum: ["account", "legacy", "backup"] }).notNull(),
  personId: text("person_id").references(() => people.id),
  deviceId: text("device_id").references(() => devices.id),
  generation: integer("generation").notNull(),
  state: text("state", { enum: ["active", "settled", "uncertain"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  settledAt: integer("settled_at"),
}, table => [index("idx_closure_admissions_state").on(table.state, table.kind, table.personId, table.deviceId),
  check("closure_admission_generation", sql`${table.generation} >= 0`),
  check("closure_admission_state", sql`${table.state} IN ('active','settled','uncertain')`),
  check("closure_admission_actor", sql`(${table.kind}='account' AND ${table.personId} IS NOT NULL AND ${table.deviceId} IS NULL) OR
    (${table.kind}='legacy' AND ${table.personId} IS NULL AND ${table.deviceId} IS NOT NULL) OR
    (${table.kind}='backup' AND ${table.personId} IS NULL AND ${table.deviceId} IS NULL)`)]);

export const closureStorageEffects = sqliteTable("closure_storage_effects", {
  id: text("id").primaryKey().notNull(),
  admissionId: text("admission_id").notNull().references(() => closureWriteAdmissions.id),
  objectKey: text("object_key").notNull(),
  operation: text("operation").notNull(),
  uploadId: text("upload_id"),
  partNumber: integer("part_number"),
  capabilityExpiresAt: integer("capability_expires_at"),
  state: text("state", { enum: ["active", "acknowledged", "uncertain"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  acknowledgedAt: integer("acknowledged_at"),
}, table => [index("idx_closure_storage_effects_admission").on(table.admissionId, table.state),
  check("closure_effect_state", sql`${table.state} IN ('active','acknowledged','uncertain')`),
  check("closure_effect_operation", sql`${table.operation} IN ('put','multipart_create','multipart_part','multipart_complete','delete','multipart_abort','multipart_capability')`),
  check("closure_effect_capability", sql`${table.operation}<>'multipart_capability' OR
    (${table.uploadId} IS NOT NULL AND ${table.partNumber} IS NOT NULL AND ${table.partNumber} BETWEEN 1 AND 10000 AND ${table.capabilityExpiresAt} IS NOT NULL)`)]);

export const closureBackupRuns = sqliteTable("closure_backup_runs", {
  id: text("id").primaryKey().notNull().references(() => closureWriteAdmissions.id),
  snapshotId: text("snapshot_id").notNull().unique(),
  receiptDigest: text("receipt_digest"),
  createdAt: integer("created_at").notNull(),
});
