import {z} from "zod";
import {AccountError,type AccountSession} from "./account-sessions";
import {intakeRecipientAuthority} from "./upload-request-authority";

type IntakeUpload={id:string;request_id:string;space_id:string;name:string;mime:string;size:number;sha256:string;object_key:string;upload_id:string;part_size:number;phase:string;attempt_key:string|null};

// Resolve storage details only after current narrow intake authority; never return keys to the form.
export async function requireIntakeUpload(database:D1Database,session:AccountSession,id:string,now=Date.now()) {
  const recipient=intakeRecipientAuthority(session,now);
  const row=await database.prepare(`SELECT m.*,i.request_id,i.phase,i.attempt_key FROM intake_submissions i JOIN media m ON m.id=i.id
    JOIN upload_requests ON upload_requests.id=i.request_id WHERE i.id=? AND i.person_id=? AND ${recipient.sql}`)
    .bind(id,session.personId,...recipient.bindings).first<IntakeUpload>();
  if(!row)throw new AccountError(404,"This upload request or submission is unavailable.");
  return row;
}

// Record a unique bounded attempt before creating provider state. A late creator cannot replace a
// newer attempt; ambiguous creation retains custody and capacity instead of inventing success.
export async function beginIntakeUpload(database:D1Database,bucket:R2Bucket,session:AccountSession,id:string) {
  const row=await requireIntakeUpload(database,session,id);
  if(["uploading","received","accepted"].includes(row.phase))return {id,partSize:row.part_size,status:row.phase};
  const now=Date.now(),key=`${row.space_id}/${row.id}/intake-${crypto.randomUUID()}/original`,recipient=intakeRecipientAuthority(session,now);
  const claimed=await database.batch([
    database.prepare(`UPDATE intake_submissions SET phase='starting',attempt_key=?,lease_expires_at=? WHERE id=?
      AND (phase='reserved' OR (phase='starting' AND lease_expires_at<=?))
      AND (SELECT COUNT(*) FROM intake_upload_attempts WHERE submission_id=intake_submissions.id)<5
      AND EXISTS(SELECT 1 FROM upload_requests WHERE id=intake_submissions.request_id AND ${recipient.sql})`)
      .bind(key,now+300000,id,now,...recipient.bindings),
    database.prepare(`INSERT INTO intake_upload_attempts(object_key,submission_id,created_at) SELECT ?,id,? FROM intake_submissions WHERE id=? AND attempt_key=? AND changes()=1`)
      .bind(key,now,id,key),
  ]);
  if(!claimed[0].meta.changes)throw new AccountError(409,"This upload is starting, its retry limit was reached, or the request changed.");
  let upload:R2MultipartUpload|null=null;
  try {
    upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:"application/octet-stream"}});
    // Custody acknowledgement is independent of continuing user authority; it never grants access.
    await database.prepare("UPDATE intake_upload_attempts SET upload_id=?,state='active' WHERE object_key=?").bind(upload.uploadId,key).run();
    const current=intakeRecipientAuthority(session);
    const installed=await database.batch([
      database.prepare(`UPDATE media SET object_key=?,upload_id=? WHERE id=? AND status='receiving'
        AND EXISTS(SELECT 1 FROM intake_submissions i JOIN upload_requests ON upload_requests.id=i.request_id
          WHERE i.id=media.id AND i.phase='starting' AND i.attempt_key=? AND ${current.sql})`)
        .bind(key,upload.uploadId,id,key,...current.bindings),
      database.prepare("UPDATE intake_submissions SET phase='uploading',lease_expires_at=0 WHERE id=? AND attempt_key=? AND changes()=1").bind(id,key),
    ]);
    if(!installed[0].meta.changes)throw new AccountError(409,"Request access changed before this upload started.");
    return {id,partSize:row.part_size,status:"uploading"};
  } catch(failure) {
    if(upload){
      try{await upload.abort();await database.prepare("UPDATE intake_upload_attempts SET state='abort-acknowledged' WHERE object_key=?").bind(key).run();}
      catch{await database.prepare("UPDATE intake_upload_attempts SET state='uncertain' WHERE object_key=?").bind(key).run();throw new AccountError(503,"The upload needs storage reconciliation. Its reservation remains held.");}
      await database.prepare("UPDATE intake_submissions SET phase='reserved',lease_expires_at=0 WHERE id=? AND phase='starting' AND attempt_key=?").bind(id,key).run();
    }else await database.prepare("UPDATE intake_upload_attempts SET state='uncertain' WHERE object_key=?").bind(key).run();
    if(failure instanceof AccountError)throw failure;
    throw new AccountError(503,"This upload could not start. Retry after its pending attempt is reviewed.");
  }
}

const partsSchema=z.array(z.object({partNumber:z.number().int().min(1).max(16),etag:z.string().min(1).max(200)})).min(1).max(16);

// Completing multipart transport records received-for-review, never a verified or library-visible
// original. Authority is checked again after storage completion, including expiry and request closure.
export async function completeIntakeUpload(database:D1Database,bucket:R2Bucket,session:AccountSession,id:string,parts:unknown) {
  const row=await requireIntakeUpload(database,session,id);
  if(row.phase==="received"||row.phase==="accepted")return {received:true,verified:row.phase==="accepted"};
  if(row.phase!=="uploading")throw new AccountError(409,"This upload is not accepting completion.");
  const parsed=partsSchema.safeParse(parts);
  if(!parsed.success)throw new AccountError(400,"Review the completed upload parts.");
  const ordered=parsed.data.sort((a,b)=>a.partNumber-b.partNumber);
  if(ordered.length!==Math.ceil(row.size/row.part_size)||ordered.some((part,index)=>part.partNumber!==index+1))throw new AccountError(400,"Some upload parts are missing.");
  const object=await bucket.head(row.object_key)??await bucket.resumeMultipartUpload(row.object_key,row.upload_id).complete(ordered);
  if(object.size!==row.size)throw new AccountError(409,"Received size does not match the original. This file remains outside the library.");
  const current=intakeRecipientAuthority(session);
  const received=await database.batch([
    database.prepare(`UPDATE intake_submissions SET phase='received' WHERE id=? AND phase='uploading' AND attempt_key=?
      AND EXISTS(SELECT 1 FROM upload_requests WHERE id=intake_submissions.request_id AND ${current.sql})`).bind(id,row.object_key,...current.bindings),
    database.prepare("UPDATE media SET status='pending-review' WHERE id=? AND object_key=? AND status='receiving' AND changes()=1").bind(id,row.object_key),
  ]);
  if(!received[0].meta.changes)throw new AccountError(409,"The request changed before receipt. This file has not entered the library.");
  return {received:true,verified:false};
}
