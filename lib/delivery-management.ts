import {z} from "zod";
import {AccountError} from "./account-sessions";
import type {AccountSpaceAccess} from "./account-space-access";
import {transferAuthority} from "./transfer-authority";
import {newAssetAudienceAuthority} from "./asset-scope-authority";
import {deliverySourceAuthority} from "./delivery-authority";

const draftSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(120),senderName:z.string().trim().min(1).max(120).default("Relay member"),accessScopeId:z.string().uuid().nullable(),
  files:z.array(z.object({id:z.string().uuid(),revision:z.number().int().nonnegative()})).min(1).max(100),
  recipients:z.array(z.object({id:z.string().uuid(),email:z.string().trim().email().max(320).transform(value=>value.toLowerCase()),tokenHash:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(20),
  expiresAt:z.number().int().positive(),confirmed:z.literal(true),confirmAudienceExpansion:z.literal(true)});

// Capture the whole reviewed selection transactionally. A stable ID retries the exact sender,
// selection, recipients and expiry; drafts grant no recipient access or independent original copies.
export async function createDeliveryDraft(database:D1Database,owner:AccountSpaceAccess,input:z.input<typeof draftSchema>,now=Date.now()){
  const parsed=draftSchema.safeParse(input);
  if(!parsed.success)throw new AccountError(400,"Review the delivery title, selection, recipients and expiry.");
  const value=parsed.data;
  if(value.expiresAt<=now||value.expiresAt>now+2592000000||new Set(value.files.map(file=>file.id)).size!==value.files.length||
    new Set(value.recipients.map(recipient=>recipient.id)).size!==value.recipients.length||new Set(value.recipients.map(recipient=>recipient.email)).size!==value.recipients.length||
    new Set(value.recipients.map(recipient=>recipient.tokenHash)).size!==value.recipients.length)throw new AccountError(400,"Use distinct files and recipients, with an expiry within 30 days.");
  const intentHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({personId:owner.personId,spaceId:owner.space_id,...value})))),byte=>byte.toString(16).padStart(2,"0")).join("");
  const live=transferAuthority(owner,now,true),audience=newAssetAudienceAuthority(owner,value.accessScopeId),files=JSON.stringify(value.files);
  const selection=`SELECT m.* FROM json_each(?) selected JOIN media m ON m.id=json_extract(selected.value,'$.id')
    WHERE m.space_id=? AND m.access_scope_id IS ? AND m.revision=json_extract(selected.value,'$.revision') AND m.status='ready' AND m.archived_at IS NULL
    AND m.size>0 AND length(m.sha256)=64 AND m.sha256 NOT GLOB '*[^0-9a-f]*'`;
  const selectionBindings=[files,owner.space_id,value.accessScopeId];
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO delivery_snapshots(id,space_id,issuer_membership_id,access_scope_id,title,sender_name,intent_hash,file_count,total_bytes,created_at,expires_at)
      SELECT ?,?,actor.membership_id,?,?,?,?,?,(SELECT SUM(size) FROM (${selection})),?,? FROM account_space_actors actor
      WHERE actor.device_id=? AND ${live.sql} AND ${audience.sql} AND (SELECT COUNT(*) FROM (${selection}))=?
      AND (SELECT COUNT(*) FROM delivery_snapshots WHERE space_id=? AND state IN ('draft','issued','suspended') AND expires_at>? AND revoked_at IS NULL)<100`)
      .bind(value.id,owner.space_id,value.accessScopeId,value.title,value.senderName,intentHash,value.files.length,...selectionBindings,now,value.expiresAt,owner.id,...live.bindings,...audience.bindings,...selectionBindings,value.files.length,owner.space_id,now),
    database.prepare(`INSERT INTO delivery_items(delivery_id,media_id,position,source_revision,name,mime,size,sha256,captured_at)
      SELECT ?,m.id,CAST(selected.key AS INTEGER),m.revision,m.name,m.mime,m.size,m.sha256,m.captured_at FROM json_each(?) selected JOIN media m ON m.id=json_extract(selected.value,'$.id')
      WHERE changes()=1 AND EXISTS(SELECT 1 FROM delivery_snapshots WHERE id=? AND intent_hash=? AND state='draft')`)
      .bind(value.id,files,value.id,intentHash),
    database.prepare(`INSERT INTO delivery_recipients(id,delivery_id,email,token_hash)
      SELECT json_extract(recipient.value,'$.id'),?,json_extract(recipient.value,'$.email'),json_extract(recipient.value,'$.tokenHash') FROM json_each(?) recipient
      WHERE changes()>0 AND EXISTS(SELECT 1 FROM delivery_snapshots WHERE id=? AND intent_hash=? AND state='draft')`)
      .bind(value.id,JSON.stringify(value.recipients),value.id,intentHash),
  ]);
  const draft=await database.prepare(`SELECT id,state,revision,intent_hash AS intentHash FROM delivery_snapshots WHERE id=? AND intent_hash=? AND state<>'revoked'
    AND issuer_membership_id=(SELECT membership_id FROM account_space_actors WHERE device_id=?) AND ${live.sql} AND ${audience.sql}`)
    .bind(value.id,intentHash,owner.id,...live.bindings,...audience.bindings).first();
  if(!draft)throw new AccountError(409,"The selection or your access changed. Review a new delivery.");
  return draft;
}

// Only the original sender may deliberately issue or reactivate a snapshot. Initial publication
// rejects stale revisions; reactivation keeps the old reviewed labels but requires every original.
export async function issueDelivery(database:D1Database,owner:AccountSpaceAccess,id:string,expectedRevision:number,now=Date.now()){
  if(!z.string().uuid().safeParse(id).success||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new AccountError(400,"Refresh the delivery review.");
  const row=await database.prepare('SELECT state,access_scope_id FROM delivery_snapshots WHERE id=? AND space_id=?').bind(id,owner.space_id).first<{state:string;access_scope_id:string|null}>();
  if(!row||!["draft","suspended","issued"].includes(row.state))throw new AccountError(404,"This delivery is unavailable.");
  const live=transferAuthority(owner,now,true),audience=newAssetAudienceAuthority(owner,row.access_scope_id),source=deliverySourceAuthority(now,row.state as "draft"|"suspended"|"issued");
  const issuer=`issuer_membership_id=(SELECT membership_id FROM account_space_actors WHERE device_id=?) AND ${live.sql} AND ${audience.sql}`;
  await database.prepare(`UPDATE delivery_snapshots SET state='issued',revision=revision+1 WHERE id=? AND revision=? AND state IN ('draft','suspended')
    AND ${issuer} AND ${source.sql} AND (state<>'draft' OR NOT EXISTS(SELECT 1 FROM delivery_items item JOIN media m ON m.id=item.media_id WHERE item.delivery_id=delivery_snapshots.id AND item.source_revision<>m.revision))`)
    .bind(id,expectedRevision,owner.id,...live.bindings,...audience.bindings,...source.bindings).run();
  const issued=deliverySourceAuthority(now);
  const result=await database.prepare(`SELECT id,revision FROM delivery_snapshots WHERE id=? AND revision=? AND ${issuer} AND ${issued.sql}`)
    .bind(id,expectedRevision+1,owner.id,...live.bindings,...audience.bindings,...issued.bindings).first();
  if(!result)throw new AccountError(409,"The delivery or source changed. Refresh and review before publishing.");
  return result;
}

// Revocation can be performed by a current source-space owner with the content audience grant.
// It stops new access, while already saved originals and admitted download capabilities remain bounded exceptions.
export async function revokeDelivery(database:D1Database,owner:AccountSpaceAccess,id:string,expectedRevision:number,now=Date.now()){
  const row=await database.prepare('SELECT access_scope_id FROM delivery_snapshots WHERE id=? AND space_id=?').bind(id,owner.space_id).first<{access_scope_id:string|null}>();
  if(!row)throw new AccountError(404,"This delivery is unavailable.");
  const live=transferAuthority(owner,now,true),audience=newAssetAudienceAuthority(owner,row.access_scope_id);
  await database.prepare(`UPDATE delivery_snapshots SET state='revoked',revoked_at=COALESCE(revoked_at,?),revision=revision+1 WHERE id=? AND revision=? AND state<>'revoked' AND ${live.sql} AND ${audience.sql}`)
    .bind(now,id,expectedRevision,...live.bindings,...audience.bindings).run();
  const result=await database.prepare(`SELECT id,revision FROM delivery_snapshots WHERE id=? AND state='revoked' AND ${live.sql} AND ${audience.sql}`)
    .bind(id,...live.bindings,...audience.bindings).first();
  if(!result)throw new AccountError(409,"The delivery changed. Refresh before revoking it.");
  return result;
}
