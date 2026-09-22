import {z} from "zod";
import {ApiError,database,readJson,spaceLimitBytes,tokenHash} from "./server";
import type {AccountSpaceAccess} from "./account-space-access";
import {intakeEnabled} from "./intake-runtime";
import {resourceAudienceAuthority} from "./asset-scope-authority";
import {transferAuthority} from "./transfer-authority";
import {createUploadRequestDraft,closeUploadRequest} from "./upload-request-management";
import {activateUploadRequest} from "./upload-request-reservations";
import {acceptIntakeOriginal} from "./intake-review";

// Owner views use current role and content audience on every query. Administrative ownership alone
// cannot list a restricted collection's title, recipient or incoming filenames without a grant.
export async function uploadRequestAction(request:Request,owner:AccountSpaceAccess|null,id:string|undefined,action:string|undefined,storage:R2Bucket) {
  if(!intakeEnabled())throw new ApiError(404,"Upload requests are unavailable.");
  if(!owner||owner.role!=="owner"||owner.space_kind!=="shared")throw new ApiError(403,"A shared-space owner manages upload requests.");
  const live=transferAuthority(owner,Date.now(),true),audience=resourceAudienceAuthority(owner,"upload_requests"),guard=`${live.sql} AND ${audience.sql}`,values=[...live.bindings,...audience.bindings];
  const db=database();
  if(request.method==="GET"&&!action){
    const requests=await db.prepare(`SELECT id,title,recipient_email AS recipientEmail,album_id AS albumId,section_id AS sectionId,access_scope_id AS accessScopeId,
      expires_at AS expiresAt,revoked_at AS revokedAt,state,revision,max_files AS maxFiles,max_file_bytes AS maxFileBytes,max_bytes AS maxBytes
      FROM upload_requests WHERE ${guard}${id?" AND id=?":""} ORDER BY created_at DESC,id DESC LIMIT 100`).bind(...values,...(id?[id]:[])).all();
    if(id&&!requests.results.length)throw new ApiError(404,"This upload request is unavailable.");
    const submissions=id?await db.prepare(`SELECT i.id,m.name,i.size,i.phase,i.verified_at AS verifiedAt FROM intake_submissions i LEFT JOIN media m ON m.id=i.id
      JOIN upload_requests ON upload_requests.id=i.request_id WHERE i.request_id=? AND ${guard} ORDER BY i.created_at,i.id LIMIT 100`).bind(id,...values).all():null;
    return Response.json({requests:requests.results,...(submissions?{submissions:submissions.results}:{})});
  }
  if(request.method==="POST"&&!id){
    const input=await readJson(request,z.object({id:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(120),recipientEmail:z.string().email().max(320),
      albumId:z.string().uuid(),sectionId:z.string().uuid().nullable(),accessScopeId:z.string().uuid().nullable(),expiresAt:z.number().int(),maxFiles:z.number().int(),maxFileBytes:z.number().int(),maxBytes:z.number().int(),confirmed:z.literal(true)}));
    await createUploadRequestDraft(db,owner,{...input,tokenHash:await tokenHash(input.token)});
    return Response.json(await activateUploadRequest(db,owner,input.id,spaceLimitBytes(owner)));
  }
  if(id&&!action&&request.method==="DELETE"){
    const input=await readJson(request,z.object({expectedRevision:z.number().int().nonnegative()}));return Response.json(await closeUploadRequest(db,owner,id,input.expectedRevision));
  }
  if(id&&action==="accept"&&request.method==="POST"){
    const input=await readJson(request,z.object({fileId:z.string().uuid(),confirmed:z.literal(true)}));
    if(!await db.prepare(`SELECT i.id FROM intake_submissions i JOIN upload_requests ON upload_requests.id=i.request_id WHERE i.id=? AND i.request_id=? AND ${guard}`).bind(input.fileId,id,...values).first())throw new ApiError(404,"This received file is unavailable.");
    return Response.json(await acceptIntakeOriginal(db,storage,owner,input.fileId));
  }
  throw new ApiError(404,"This upload request action is unavailable.");
}
