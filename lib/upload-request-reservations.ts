import {z} from "zod";
import {AccountError,type AccountSession} from "./account-sessions";
import type {AccountSpaceAccess} from "./account-space-access";
import {transferAuthority} from "./transfer-authority";
import {intakeIssuerAuthority,intakeRecipientAuthority} from "./upload-request-authority";

// Reserve the whole promised allowance in media, the common quota ledger already used by ordinary
// uploads and publications. The intake-only expired attribution device cannot authenticate a library.
// This preparation has no route; the draft must already contain reviewed immutable destination/limits.
export async function activateUploadRequest(database:D1Database,owner:AccountSpaceAccess,id:string,spaceLimit:number,now=Date.now()) {
  if(!Number.isSafeInteger(spaceLimit)||spaceLimit<1)throw new AccountError(409,"Storage capacity is unavailable.");
  const live=transferAuthority(owner,now,true),issuer=intakeIssuerAuthority(now,"draft");
  const guard=`upload_requests.id=? AND upload_requests.space_id=? AND upload_requests.issuer_membership_id=
    (SELECT membership_id FROM account_space_actors WHERE device_id=?) AND ${issuer.sql} AND ${live.sql}`;
  const values=[id,owner.space_id,owner.id,...issuer.bindings,...live.bindings];
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO devices(id,space_id,name,token_hash,role,created_at,expires_at)
      SELECT id,space_id,'Upload request','intake-attribution:'||id,'member',?,0 FROM upload_requests WHERE ${guard}`)
      .bind(now,...values),
    database.prepare(`INSERT OR IGNORE INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id)
      SELECT id,space_id,id,'Upload request allowance','application/octet-stream',max_bytes,?,'original',space_id||'/'||id||'/allowance',
        'intake-allowance:'||id,0,'collecting',?,access_scope_id FROM upload_requests WHERE ${guard}
      AND EXISTS(SELECT 1 FROM devices d WHERE d.id=upload_requests.id AND d.space_id=upload_requests.space_id AND d.token_hash='intake-attribution:'||upload_requests.id AND d.expires_at=0)
      AND (SELECT COUNT(*) FROM upload_requests other WHERE other.space_id=upload_requests.space_id AND other.state='open' AND other.revoked_at IS NULL AND other.expires_at>?)<10
      AND (SELECT COALESCE(SUM(size+preview_size),0) FROM media WHERE space_id=upload_requests.space_id)+max_bytes<=?`)
      .bind("0".repeat(64),now,...values,now,spaceLimit),
    database.prepare(`UPDATE upload_requests SET state='open',revision=revision+1 WHERE ${guard}
      AND EXISTS(SELECT 1 FROM media m WHERE m.id=upload_requests.id AND m.space_id=upload_requests.space_id AND m.device_id=upload_requests.id
        AND m.status='collecting' AND m.upload_id='intake-allowance:'||upload_requests.id AND m.size=upload_requests.max_bytes AND m.access_scope_id IS upload_requests.access_scope_id)`)
      .bind(...values),
  ]);
  const current=intakeIssuerAuthority(now);
  const result=await database.prepare(`SELECT id,state,max_bytes AS reservedBytes FROM upload_requests WHERE id=? AND space_id=?
    AND issuer_membership_id=(SELECT membership_id FROM account_space_actors WHERE device_id=?) AND ${current.sql} AND ${live.sql}`)
    .bind(id,owner.space_id,owner.id,...current.bindings,...live.bindings).first();
  if(!result)throw new AccountError(409,"The request, destination or available storage changed. Review it again.");
  return result;
}

const submissionSchema=z.object({id:z.string().uuid(),requestId:z.string().uuid(),name:z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/),
  mime:z.string().min(1).max(120).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),size:z.number().int().positive().max(262144000),sha256:z.string().regex(/^[a-f0-9]{64}$/)});

// Atomically exchange promised allowance for one staged original. Total charged media bytes remain
// unchanged, and request byte/file ceilings include every historical attempt to prevent quota churn.
// R2 work must start only after this transaction and carry its own tracked capability custody.
export async function reserveIntakeSubmission(database:D1Database,session:AccountSession,input:z.infer<typeof submissionSchema>,now=Date.now()):Promise<{id:string;reserved:boolean}> {
  const parsed=submissionSchema.safeParse(input);
  if(!parsed.success)throw new AccountError(400,"Choose a valid file within the upload request limits.");
  const value=parsed.data,recipient=intakeRecipientAuthority(session,now);
  const existing=await database.prepare(`SELECT i.id,i.request_id,i.person_id,i.size,i.sha256,m.name,m.mime FROM intake_submissions i LEFT JOIN media m ON m.id=i.id WHERE i.id=?`).bind(value.id).first<Record<string,string|number>>();
  if(existing){
    const allowed=await database.prepare(`SELECT 1 FROM upload_requests WHERE id=? AND ${recipient.sql}`).bind(value.requestId,...recipient.bindings).first();
    if(!allowed||existing.request_id!==value.requestId||existing.person_id!==session.personId||existing.size!==value.size||existing.sha256!==value.sha256||existing.name!==value.name||existing.mime!==value.mime)
      throw new AccountError(409,"This upload intent or access changed.");
    return {id:value.id,reserved:true};
  }
  const marker="intake-reservation:"+crypto.randomUUID();
  const results=await database.batch([
    database.prepare(`UPDATE media SET size=size-? WHERE id=? AND status='collecting' AND upload_id='intake-allowance:'||id AND size>=?
      AND NOT EXISTS(SELECT 1 FROM media WHERE id=?)
      AND EXISTS(SELECT 1 FROM upload_requests WHERE id=? AND ${recipient.sql} AND max_file_bytes>=?
        AND (SELECT COUNT(*) FROM intake_submissions WHERE request_id=upload_requests.id)<max_files
        AND (SELECT COALESCE(SUM(size),0) FROM intake_submissions WHERE request_id=upload_requests.id)+?<=max_bytes)`)
      .bind(value.size,value.requestId,value.size,value.id,value.requestId,...recipient.bindings,value.size,value.size),
    database.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id)
      SELECT ?,space_id,id,?,?,?,?, 'original',space_id||'/'||?||'/intake-original',?,16777216,'receiving',?,access_scope_id FROM upload_requests WHERE id=? AND changes()=1`)
      .bind(value.id,value.name,value.mime,value.size,value.sha256,value.id,marker,now,value.requestId),
    database.prepare(`INSERT INTO intake_submissions(id,request_id,person_id,size,sha256,created_at)
      SELECT id,?,?,size,sha256,? FROM media WHERE id=? AND upload_id=? AND status='receiving'`)
      .bind(value.requestId,session.personId,now,value.id,marker),
  ]);
  if(!results[0].meta.changes){
    // Two exact retries may both preflight before the first commits. Recheck the winning immutable
    // intent through the same authority/matching path; a collision never adopts somebody else's file.
    if(await database.prepare("SELECT id FROM intake_submissions WHERE id=?").bind(value.id).first())return reserveIntakeSubmission(database,session,value,now);
    throw new AccountError(409,"The request limit, destination or access changed. No new file was reserved.");
  }
  return {id:value.id,reserved:true};
}
