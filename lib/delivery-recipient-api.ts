import {z} from "zod";
import {AccountError,readAccountSession,readAccountToken,type AccountSession} from "./account-sessions";
import {readAuth0Settings} from "./auth0-config";
import {ApiError,attachmentName,bucket,database,isLocal,readJson,signedObjectUrl,storageMode,tokenHash} from "./server";
import {deliveriesEnabled} from "./delivery-runtime";
import {acceptDelivery,deliveryRecipientAuthority,deliverySourceAuthority} from "./delivery-authority";
import {limitDeviceRequest} from "./request-security";
import {runClosureTrackedRequest} from "./closure-tracked-request";

// Named delivery access authenticates a person without resolving or creating a source membership.
// Exact-origin mutations and optional closure admissions apply independently of possession of a link.
export async function deliveryRecipientRequest(request:Request,segments:string[]){
  if(!deliveriesEnabled())throw new ApiError(404,"Deliveries are unavailable.");
  if(new URL(request.url).searchParams.has("space"))throw new ApiError(400,"A delivery is separate from library access.");
  const settings=readAuth0Settings(process.env),token=readAccountToken(request);
  if(!settings||new URL(request.url).origin!==settings.appOrigin||!token)throw new AccountError(401,"Sign in to open this delivery.");
  if(request.method!=="GET"&&request.headers.get("Origin")!==settings.appOrigin)throw new AccountError(403,"Open this delivery in Relay before continuing.");
  const session=await readAccountSession(database(),settings,token);
  if(!session)throw new AccountError(401,"Sign in to open this delivery.");
  await limitDeviceRequest(request,"delivery:"+session.personId,"delivery",segments[1],segments[3]);
  if(process.env.RELAY_CLOSURE_TRACKING_ENABLED==="true"&&request.method!=="GET")return runClosureTrackedRequest(database(),bucket(),{kind:"account",session},
    (_,admissionId)=>authenticatedDeliveryRequest(request,segments,{...session,closureAdmissionId:admissionId}));
  return authenticatedDeliveryRequest(request,segments,session);
}

// Preview grants no file metadata. A current invited email may preview; an accepted person retains
// their own grant after changing email, and no later holder of that email inherits the invitation.
async function previewDelivery(session:AccountSession,hash:string){
  const source=deliverySourceAuthority(),now=Date.now();
  const result=await database().prepare(`SELECT delivery_snapshots.id,delivery_snapshots.title,delivery_snapshots.expires_at AS expiresAt,
    delivery_snapshots.file_count AS fileCount,delivery_snapshots.total_bytes AS totalBytes,delivery_snapshots.sender_name AS senderName
    FROM delivery_snapshots JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id
    WHERE delivery_recipients.token_hash=? AND delivery_recipients.revoked_at IS NULL AND ${source.sql}
    AND EXISTS(SELECT 1 FROM account_sessions current JOIN people p ON p.id=current.person_id WHERE current.id=? AND p.id=? AND current.revoked_at IS NULL
      AND current.expires_at>? AND p.disabled_at IS NULL AND current.authenticated_at>=p.credentials_changed_at
      AND (delivery_recipients.accepted_by=p.id OR (delivery_recipients.accepted_by IS NULL AND lower(delivery_recipients.email)=lower(p.verified_email))))`)
    .bind(hash,...source.bindings,session.sessionId,session.personId,now).first();
  if(!result)throw new AccountError(404,"This delivery is unavailable for this account.");
  return result;
}

// Read the entire snapshot consistently. No partial list, source key, private album label or other
// recipient identity is returned when any original or current grant becomes unavailable.
async function readDelivery(session:AccountSession,id:string){
  const authority=deliveryRecipientAuthority(session),db=database();
  const [header,items]=await db.batch([
    db.prepare(`SELECT delivery_snapshots.id,delivery_snapshots.title,delivery_snapshots.sender_name AS senderName,delivery_snapshots.expires_at AS expiresAt,delivery_snapshots.file_count AS fileCount,
      delivery_snapshots.total_bytes AS totalBytes FROM delivery_snapshots JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id WHERE delivery_snapshots.id=? AND ${authority.sql}`)
      .bind(id,...authority.bindings),
    db.prepare(`SELECT DISTINCT item.media_id AS id,item.name,item.mime,item.size,item.sha256,item.captured_at AS capturedAt,item.position FROM delivery_items item
      JOIN delivery_snapshots ON delivery_snapshots.id=item.delivery_id JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id
      WHERE delivery_snapshots.id=? AND ${authority.sql} ORDER BY item.position`).bind(id,...authority.bindings),
  ]);
  if(!header.results.length)throw new AccountError(404,"This delivery has ended or is unavailable.");
  return {delivery:header.results[0],items:items.results};
}

// Download admission is short-lived and rechecked for the whole source snapshot. It never means the
// recipient saved a complete file; already-started transfers and saved copies cannot be recalled.
async function authenticatedDeliveryRequest(request:Request,segments:string[],session:AccountSession):Promise<Response>{
  const [,id,fileId,action]=segments,db=database();
  if(["preview","accept"].includes(id)&&!fileId&&request.method==="POST"){
    const input=await readJson(request,z.object({token:z.string().regex(/^[a-f0-9]{64}$/)})),hash=await tokenHash(input.token);
    return Response.json(id==="preview"?await previewDelivery(session,hash):await acceptDelivery(db,session,hash));
  }
  if(id&&!fileId&&request.method==="GET")return Response.json(await readDelivery(session,id));
  if(id&&fileId&&["link","original","download"].includes(action)&&request.method==="GET"){
    const authority=deliveryRecipientAuthority(session);
    const row=await db.prepare(`SELECT item.name,item.size,item.sha256,m.object_key,delivery_snapshots.expires_at FROM delivery_items item JOIN media m ON m.id=item.media_id
      JOIN delivery_snapshots ON delivery_snapshots.id=item.delivery_id JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id
      WHERE item.delivery_id=? AND item.media_id=? AND ${authority.sql}`).bind(id,fileId,...authority.bindings)
      .first<{name:string;size:number;sha256:string;object_key:string;expires_at:number}>();
    if(!row)throw new AccountError(404,"This delivery is unavailable.");
    if(["original","download"].includes(action)&&isLocal(request)){
      const object=await bucket().get(row.object_key);
      if(!object||object.size!==row.size){await object?.body.cancel();throw new AccountError(409,"This original is temporarily unavailable.");}
      return new Response(object.body,{headers:{"Content-Type":"application/octet-stream","Content-Length":String(row.size),"Content-Disposition":attachmentName(row.name),"X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
    }
    if(!["link","download"].includes(action))throw new ApiError(404,"This delivery action is unavailable.");
    if(storageMode(request)==="unconfigured")throw new ApiError(503,"Original downloads are temporarily unavailable.");
    const signedAt=Math.floor(Date.now()/1000)*1000,ttl=Math.min(60,Math.floor((row.expires_at-signedAt)/1000));
    if(ttl<5)throw new AccountError(410,"This delivery is expiring. Ask the sender for a new delivery.");
    const url=isLocal(request)?`/api/delivery/${id}/${fileId}/original`:await signedObjectUrl(row.object_key,"GET",{"X-Amz-Expires":String(ttl),"response-content-disposition":attachmentName(row.name),"response-content-type":"application/octet-stream"},undefined,signedAt);
    if(action==="download")return Response.redirect(url,302);
    return Response.json({url,expiresAt:signedAt+ttl*1000,size:row.size,sha256:row.sha256,status:"download-started"});
  }
  throw new ApiError(404,"This delivery action is unavailable.");
}
