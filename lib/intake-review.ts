import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {AccountError} from "./account-sessions";
import type {AccountSpaceAccess} from "./account-space-access";
import {resourceAudienceAuthority} from "./asset-scope-authority";
import {transferAuthority} from "./transfer-authority";
import {arrivalActivityStatement} from "./library-activity-statements";

// Hash incrementally: never buffer a potentially 250 MiB original in the Worker's bounded heap.
// Multipart completion makes this unique attempt key immutable to contributor capabilities.
export async function verifyIntakeOriginal(body:ReadableStream<Uint8Array>,size:number,expectedHash:string) {
  const reader=body.getReader(),hash=sha256.create();let length=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;
      if(length>size)throw new AccountError(409,"The original exceeds its reserved size.");hash.update(part.value);}
    if(length!==size||bytesToHex(hash.digest())!==expectedHash)throw new AccountError(409,"The original checksum does not match. This file remains outside the library.");
  }catch(failure){await reader.cancel().catch(()=>{});throw failure;}
  finally{reader.releaseLock();hash.destroy();}
}

// Review downloads never make a staged original library-visible. Verify the immutable completed
// object first, then check current owner/audience authority again before returning attachment bytes.
export async function readIntakeReviewOriginal(database:D1Database,bucket:R2Bucket,owner:AccountSpaceAccess,id:string){
  const authority=()=>{const live=transferAuthority(owner,Date.now(),true),audience=resourceAudienceAuthority(owner,"m");return {sql:`${live.sql} AND ${audience.sql}`,bindings:[...live.bindings,...audience.bindings]};};
  const initial=authority();
  const row=await database.prepare(`SELECT m.id,m.name,m.object_key,m.size,m.sha256 FROM media m JOIN intake_submissions i ON i.id=m.id
    WHERE m.id=? AND ((m.status='pending-review' AND i.phase='received') OR (m.status='intake-rejected' AND i.phase='rejected')) AND ${initial.sql}`)
    .bind(id,...initial.bindings).first<{id:string;name:string;object_key:string;size:number;sha256:string}>();
  if(!row)throw new AccountError(404,"This received original is unavailable.");
  const source=await bucket.get(row.object_key);
  if(!source)throw new AccountError(409,"The received original is unavailable for review.");
  await verifyIntakeOriginal(source.body,row.size,row.sha256);
  const object=await bucket.get(row.object_key),current=authority();
  if(!object||object.etag!==source.etag||object.size!==row.size){await object?.body.cancel();throw new AccountError(409,"The original changed before review. Refresh this request.");}
  if(!await database.prepare(`SELECT m.id FROM media m WHERE m.id=? AND m.object_key=? AND m.status IN ('pending-review','intake-rejected') AND ${current.sql}`)
    .bind(id,row.object_key,...current.bindings).first()){await object.body.cancel();throw new AccountError(404,"This original or your access changed.");}
  return {name:row.name,size:row.size,body:object.body};
}

// Decline is reversible metadata: retain bytes, capacity and custody without publishing the file.
// A later restore returns it to review; it does not accept it or reopen the contributor's request.
export async function changeIntakeReview(database:D1Database,owner:AccountSpaceAccess,id:string,restore:boolean){
  const live=transferAuthority(owner,Date.now(),true),audience=resourceAudienceAuthority(owner,"m");
  const phase=restore?"received":"rejected",status=restore?"pending-review":"intake-rejected";
  const previousPhase=restore?"rejected":"received",previousStatus=restore?"intake-rejected":"pending-review";
  const result=await database.batch([
    database.prepare(`UPDATE media AS m SET status=? WHERE id=? AND status=? AND ${live.sql} AND ${audience.sql}
      AND EXISTS(SELECT 1 FROM intake_submissions i WHERE i.id=m.id AND i.phase=?)`)
      .bind(status,id,previousStatus,...live.bindings,...audience.bindings,previousPhase),
    database.prepare('UPDATE intake_submissions SET phase=? WHERE id=? AND phase=? AND changes()=1').bind(phase,id,previousPhase),
  ]);
  if(!result[0].meta.changes&&!await database.prepare(`SELECT m.id FROM media m JOIN intake_submissions i ON i.id=m.id WHERE m.id=? AND m.status=? AND i.phase=? AND ${live.sql} AND ${audience.sql}`)
    .bind(id,status,phase,...live.bindings,...audience.bindings).first())throw new AccountError(409,"The original or your access changed. Refresh this request.");
  return {phase,bytesRetained:true};
}

// An owner deliberately accepts already-received shared work, even after collection closes. New
// recipient uploads still require an open request. Require current scope/role/destination at commit,
// publish once with a destination-only arrival event, and retain independent verification evidence.
export async function acceptIntakeOriginal(database:D1Database,bucket:R2Bucket,owner:AccountSpaceAccess,id:string) {
  const authority=()=>{const live=transferAuthority(owner,Date.now(),true),audience=resourceAudienceAuthority(owner,"m");
    return {sql:`${live.sql} AND ${audience.sql}`,bindings:[...live.bindings,...audience.bindings]};};
  const initial=authority();
  const row=await database.prepare(`SELECT m.id,m.object_key,m.size,m.sha256,i.phase,r.album_id,r.section_id FROM media m
    JOIN intake_submissions i ON i.id=m.id JOIN upload_requests r ON r.id=i.request_id
    WHERE m.id=? AND ((m.status='pending-review' AND i.phase='received') OR (m.status='ready' AND i.phase='accepted')) AND ${initial.sql}`)
    .bind(id,...initial.bindings).first<{id:string;object_key:string;size:number;sha256:string;phase:string;album_id:string;section_id:string|null}>();
  if(!row)throw new AccountError(404,"This received original is unavailable.");
  if(row.phase==="accepted")return {accepted:true,verified:true,id};
  const object=await bucket.get(row.object_key);
  if(!object)throw new AccountError(409,"The received original could not be found. Its reservation remains held.");
  if(object.size!==row.size){await object.body.cancel();throw new AccountError(409,"The received size changed. This file remains outside the library.");}
  await verifyIntakeOriginal(object.body,row.size,row.sha256);
  const current=authority(),verifiedAt=Date.now();
  const committed=await database.batch([
    database.prepare(`UPDATE media AS m SET status='ready' WHERE id=? AND status='pending-review' AND object_key=? AND size=? AND sha256=?
      AND ${current.sql} AND EXISTS(SELECT 1 FROM albums a WHERE a.id=? AND a.space_id=m.space_id AND a.access_scope_id IS m.access_scope_id AND a.deleted_at IS NULL AND a.archived_at IS NULL)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM album_sections WHERE id=? AND album_id=? AND deleted_at IS NULL))`)
      .bind(id,row.object_key,row.size,row.sha256,...current.bindings,row.album_id,row.section_id,row.section_id,row.album_id),
    arrivalActivityStatement(database,id),
    database.prepare(`INSERT INTO album_media(album_id,media_id,section_id) SELECT ?,id,? FROM media WHERE id=? AND status='ready' AND object_key=? AND changes()>0 ON CONFLICT DO NOTHING`)
      .bind(row.album_id,row.section_id,id,row.object_key),
    database.prepare(`UPDATE intake_submissions SET phase='accepted',verified_at=? WHERE id=? AND phase='received'
      AND EXISTS(SELECT 1 FROM media m WHERE m.id=intake_submissions.id AND m.status='ready' AND m.object_key=? AND ${current.sql})`)
      .bind(verifiedAt,id,row.object_key,...current.bindings),
  ]);
  if(!committed[0].meta.changes)throw new AccountError(409,"The destination or your access changed before acceptance. Refresh this request.");
  return {accepted:true,verified:true,id};
}
