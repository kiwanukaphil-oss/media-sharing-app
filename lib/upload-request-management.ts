import {z} from "zod";
import {AccountError} from "./account-sessions";
import type {AccountSpaceAccess} from "./account-space-access";
import {transferAuthority} from "./transfer-authority";
import {newAssetAudienceAuthority} from "./asset-scope-authority";

const draftSchema=z.object({id:z.string().uuid(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().trim().min(1).max(120),
  recipientEmail:z.string().trim().email().max(320).transform(value=>value.toLowerCase()),albumId:z.string().uuid(),sectionId:z.string().uuid().nullable(),
  accessScopeId:z.string().uuid().nullable(),expiresAt:z.number().int().positive(),maxFiles:z.number().int().min(1).max(100),
  maxFileBytes:z.number().int().min(1).max(262144000),maxBytes:z.number().int().min(1).max(1073741824),confirmed:z.literal(true)});

// A reviewed draft is not a capability. Stable IDs retry only the same exact destination, secret hash,
// recipient and limits; activation separately reserves shared quota before any recipient can accept it.
export async function createUploadRequestDraft(database:D1Database,owner:AccountSpaceAccess,input:z.input<typeof draftSchema>,now=Date.now()) {
  const parsed=draftSchema.safeParse(input);
  if(!parsed.success)throw new AccountError(400,"Review a valid recipient, destination and request limits.");
  const value=parsed.data;
  if(value.expiresAt<=now||value.expiresAt>now+604800000||value.maxFileBytes>value.maxBytes)throw new AccountError(400,"Choose an expiry within seven days and compatible file limits.");
  const live=transferAuthority(owner,now,true),audience=newAssetAudienceAuthority(owner,value.accessScopeId);
  const matching=`id=? AND space_id=? AND issuer_membership_id=(SELECT membership_id FROM account_space_actors WHERE device_id=?)
    AND token_hash=? AND title=? AND recipient_email=? AND album_id=? AND section_id IS ? AND access_scope_id IS ?
    AND expires_at=? AND max_files=? AND max_file_bytes=? AND max_bytes=? AND revoked_at IS NULL AND state IN ('draft','open')`;
  const exact=[value.id,owner.space_id,owner.id,value.tokenHash,value.title,value.recipientEmail,value.albumId,value.sectionId,value.accessScopeId,value.expiresAt,value.maxFiles,value.maxFileBytes,value.maxBytes];
  await database.prepare(`INSERT OR IGNORE INTO upload_requests(id,token_hash,space_id,issuer_membership_id,recipient_email,title,album_id,section_id,access_scope_id,created_at,expires_at,max_files,max_file_bytes,max_bytes)
    SELECT ?,?,?,actor.membership_id,?,?,?,?,?,?,?,?,?,? FROM account_space_actors actor WHERE actor.device_id=? AND ${live.sql} AND ${audience.sql}
    AND NOT EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=?)
    AND EXISTS(SELECT 1 FROM albums a WHERE a.id=? AND a.space_id=? AND a.access_scope_id IS ? AND a.deleted_at IS NULL AND a.archived_at IS NULL)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM album_sections s WHERE s.id=? AND s.album_id=? AND s.deleted_at IS NULL))
    AND (SELECT COUNT(*) FROM upload_requests WHERE space_id=? AND state IN ('draft','open') AND revoked_at IS NULL AND expires_at>?)<10`)
    .bind(value.id,value.tokenHash,owner.space_id,value.recipientEmail,value.title,value.albumId,value.sectionId,value.accessScopeId,now,value.expiresAt,value.maxFiles,value.maxFileBytes,value.maxBytes,
      owner.id,...live.bindings,...audience.bindings,owner.space_id,value.albumId,owner.space_id,value.accessScopeId,value.sectionId,value.sectionId,value.albumId,owner.space_id,now).run();
  const result=await database.prepare(`SELECT id,state,revision FROM upload_requests WHERE ${matching} AND ${live.sql} AND ${audience.sql}`)
    .bind(...exact,...live.bindings,...audience.bindings).first();
  if(!result)throw new AccountError(409,"The request or your access changed. Review a new request.");
  return result;
}

// Closing a request stops new admissions and releases only its unused, storage-free allowance.
// Staged/accepted originals and in-flight submission custody remain charged and intact for review.
export async function closeUploadRequest(database:D1Database,owner:AccountSpaceAccess,id:string,expectedRevision:number,now=Date.now()) {
  if(!z.string().uuid().safeParse(id).success||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new AccountError(400,"Refresh this request before closing it.");
  const row=await database.prepare('SELECT access_scope_id FROM upload_requests WHERE id=? AND space_id=?').bind(id,owner.space_id).first<{access_scope_id:string|null}>();
  if(!row)throw new AccountError(404,"This upload request is unavailable.");
  const live=transferAuthority(owner,now,true),audience=newAssetAudienceAuthority(owner,row.access_scope_id);
  const guard=`space_id=? AND ${live.sql} AND ${audience.sql}`;
  const values=[owner.space_id,...live.bindings,...audience.bindings];
  const results=await database.batch([
    database.prepare(`UPDATE upload_requests SET state='closed',revoked_at=COALESCE(revoked_at,?),revision=revision+1
      WHERE id=? AND revision=? AND state<>'closed' AND ${guard}`).bind(now,id,expectedRevision,...values),
    database.prepare(`DELETE FROM media WHERE id=? AND status='collecting' AND upload_id='intake-allowance:'||id
      AND EXISTS(SELECT 1 FROM upload_requests WHERE id=media.id AND state='closed' AND ${guard})`).bind(id,...values),
  ]);
  const closed=await database.prepare(`SELECT revision FROM upload_requests WHERE id=? AND state='closed' AND ${guard}`).bind(id,...values).first();
  if(!closed)throw new AccountError(409,"This request or your access changed. Refresh before closing it.");
  return {closed:true,changed:Boolean(results[0].meta.changes),revision:closed.revision};
}
