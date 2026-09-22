import {z} from "zod";
import {AccountError,readAccountSession,readAccountToken,type AccountSession} from "./account-sessions";
import {readAuth0Settings} from "./auth0-config";
import {ApiError,bucket,database,isLocal,readJson,signedObjectUrl,storageMode,tokenHash} from "./server";
import {intakeEnabled,intakePaused} from "./intake-runtime";
import {acceptUploadRequest,intakeIssuerAuthority,intakeRecipientAuthority} from "./upload-request-authority";
import {reserveIntakeSubmission} from "./upload-request-reservations";
import {beginIntakeUpload,completeIntakeUpload,requireIntakeUpload,reserveIntakePartCapability} from "./intake-transfers";
import {runClosureTrackedRequest} from "./closure-tracked-request";
import {limitDeviceRequest} from "./request-security";

// This boundary authenticates a person without resolving any space membership. The invitation never
// flows into ordinary library APIs; origin/session/rate checks are repeated independently of a token.
export async function intakeRequest(request:Request,segments:string[]) {
  if(!intakeEnabled())throw new ApiError(404,"Upload requests are unavailable.");
  if(new URL(request.url).searchParams.has("space"))throw new ApiError(400,"An upload request is separate from library access.");
  const settings=readAuth0Settings(process.env),token=readAccountToken(request);
  if(!settings||new URL(request.url).origin!==settings.appOrigin||!token)throw new AccountError(401,"Sign in to review this upload request.");
  if(request.method!=="GET"&&request.headers.get("Origin")!==settings.appOrigin)throw new AccountError(403,"Open the request in Relay before continuing.");
  const session=await readAccountSession(database(),settings,token);
  if(!session)throw new AccountError(401,"Sign in to review this upload request.");
  await limitDeviceRequest(request,"intake:"+session.personId,"intake",segments[2],segments[3]);
  if(process.env.RELAY_CLOSURE_TRACKING_ENABLED==="true"&&request.method!=="GET")return runClosureTrackedRequest(database(),bucket(),{kind:"account",session},
    (storage,admissionId)=>authenticatedIntakeRequest(request,segments,{...session,closureAdmissionId:admissionId},storage));
  return authenticatedIntakeRequest(request,segments,session,bucket());
}

// Invitation preview discloses only the organiser-reviewed title/library and limits, never private
// destination names. Verified-email matching permits preview; acceptance binds the person permanently.
async function previewUploadRequest(session:AccountSession,hash:string) {
  const issuer=intakeIssuerAuthority(),now=Date.now();
  const result=await database().prepare(`SELECT upload_requests.id,upload_requests.title,upload_requests.expires_at AS expiresAt,
    max_files AS maxFiles,max_file_bytes AS maxFileBytes,max_bytes AS maxBytes,(SELECT name FROM spaces WHERE id=space_id) AS receivingLibrary
    FROM upload_requests WHERE token_hash=? AND ${issuer.sql} AND EXISTS(SELECT 1 FROM account_sessions current JOIN people p ON p.id=current.person_id
      WHERE current.id=? AND p.id=? AND current.revoked_at IS NULL AND current.expires_at>? AND p.disabled_at IS NULL AND current.authenticated_at>=p.credentials_changed_at
      AND (upload_requests.accepted_by=p.id OR (upload_requests.accepted_by IS NULL AND lower(upload_requests.recipient_email)=lower(p.verified_email))))`)
    .bind(hash,...issuer.bindings,session.sessionId,session.personId,now).first();
  if(!result)throw new AccountError(404,"This upload request is unavailable for this account.");
  return result;
}

// Only this accepted person's receipt metadata is returned. Library originals, other submissions,
// keys and grants are unavailable through the recipient API, including after a successful acceptance.
async function readRecipientRequest(session:AccountSession,id:string) {
  const authority=intakeRecipientAuthority(session);
  const requestQuery=database().prepare(`SELECT id,title,expires_at AS expiresAt,max_files AS maxFiles,max_file_bytes AS maxFileBytes,max_bytes AS maxBytes,
    (SELECT name FROM spaces WHERE id=space_id) AS receivingLibrary,
    max_files-(SELECT COUNT(*) FROM intake_submissions WHERE request_id=upload_requests.id) AS remainingFiles,
    max_bytes-(SELECT COALESCE(SUM(size),0) FROM intake_submissions WHERE request_id=upload_requests.id) AS remainingBytes
    FROM upload_requests WHERE id=? AND ${authority.sql}`).bind(id,...authority.bindings);
  const receiptsQuery=database().prepare(`SELECT i.id,m.name,i.size,i.sha256,i.phase,i.verified_at AS verifiedAt FROM intake_submissions i LEFT JOIN media m ON m.id=i.id
    JOIN upload_requests ON upload_requests.id=i.request_id WHERE i.request_id=? AND i.person_id=? AND ${authority.sql} ORDER BY i.created_at,i.id LIMIT 100`)
    .bind(id,session.personId,...authority.bindings);
  const [requestResult,receipts]=await database().batch([requestQuery,receiptsQuery]);
  const request=requestResult.results[0];
  if(!request)throw new AccountError(404,"This upload request has ended or is unavailable.");
  return {paused:intakePaused(),request,receipts:receipts.results,account:{personId:session.personId,verifiedEmail:session.verifiedEmail}};
}

// All mutation callers arrive through the account closure wrapper when tracking is active. Durable
// intake capability records are maintained in both modes, and unresolved bytes never become ready.
async function authenticatedIntakeRequest(request:Request,segments:string[],session:AccountSession,storage:R2Bucket):Promise<Response> {
  const [,resource,id,action]=segments,method=request.method,db=database();
  if(intakePaused()&&method!=="GET"&&resource!=="preview")throw new ApiError(503,"Uploads are temporarily paused. Your existing receipts and reserved files are retained.");
  if(["preview","accept"].includes(resource)&&!id&&method==="POST"){
    const input=await readJson(request,z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}));const hash=await tokenHash(input.token);
    return Response.json(resource==="preview"?await previewUploadRequest(session,hash):await acceptUploadRequest(db,session,hash));
  }
  if(resource==="requests"&&id&&!action&&method==="GET")return Response.json(await readRecipientRequest(session,id));
  if(resource==="uploads"&&!id&&method==="POST"){
    if(storageMode(request)==="unconfigured")throw new ApiError(503,"Direct transfers are unavailable.");
    const input=await readJson(request,z.object({id:z.string().uuid(),requestId:z.string().uuid(),name:z.string().min(1).max(255),mime:z.string().min(1).max(120),size:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}));
    await reserveIntakeSubmission(db,session,input);return Response.json(await beginIntakeUpload(db,storage,session,input.id));
  }
  if(resource==="uploads"&&id&&action==="part"&&method==="POST"){
    const input=await readJson(request,z.object({number:z.number().int().min(1).max(16)}));
    const capability=await reserveIntakePartCapability(db,session,id,input.number);
    const url=isLocal(request)?`/api/intake/uploads/${id}/bytes?part=${input.number}`:await signedObjectUrl(capability.objectKey,"PUT",
      {uploadId:capability.uploadId,partNumber:String(input.number),"X-Amz-Expires":String((capability.expiresAt-capability.signedAt)/1000)},capability.expectedBytes,capability.signedAt);
    return Response.json({url,expiresAt:capability.expiresAt});
  }
  if(resource==="uploads"&&id&&action==="bytes"&&method==="PUT"&&isLocal(request)){
    const row=await requireIntakeUpload(db,session,id),number=Number(new URL(request.url).searchParams.get("part"));
    if(row.phase!=="uploading"||!Number.isInteger(number)||number<1||number>Math.ceil(row.size/row.part_size)||!request.body)throw new ApiError(400,"Invalid upload part.");
    const expected=Math.min(row.part_size,row.size-(number-1)*row.part_size);
    if(Number(request.headers.get("Content-Length"))!==expected)throw new ApiError(400,"Incomplete upload part.");
    const result=await storage.resumeMultipartUpload(row.object_key,row.upload_id).uploadPart(number,request.body);
    return Response.json(result,{headers:{ETag:result.etag}});
  }
  if(resource==="uploads"&&id&&action==="complete"&&method==="POST"){
    const input=await readJson(request,z.object({parts:z.array(z.object({partNumber:z.number().int().positive(),etag:z.string().min(1).max(200)})).max(16)}));
    return Response.json(await completeIntakeUpload(db,storage,session,id,input.parts));
  }
  throw new ApiError(404,"This upload request action is unavailable.");
}
