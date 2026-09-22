import {z} from "zod";
import {ApiError,database,readJson,tokenHash} from "./server";
import type {AccountSpaceAccess} from "./account-space-access";
import {transferAuthority} from "./transfer-authority";
import {resourceAudienceAuthority} from "./asset-scope-authority";
import {deliveriesEnabled} from "./delivery-runtime";
import {createDeliveryDraft,issueDelivery,revokeDelivery} from "./delivery-management";

// Source owners review exact captured metadata and named recipients. Scope authority still applies
// to administrative lists; a title, recipient address or old selection never bypasses that boundary.
export async function deliveryOwnerAction(request:Request,owner:AccountSpaceAccess|null,id:string|undefined,action:string|undefined){
  if(!deliveriesEnabled())throw new ApiError(404,"Deliveries are unavailable.");
  if(!owner||owner.role!=="owner")throw new ApiError(403,"A library owner manages deliveries.");
  const db=database(),live=transferAuthority(owner,Date.now(),true),audience=resourceAudienceAuthority(owner,"delivery_snapshots");
  const guard=`${live.sql} AND ${audience.sql}`,values=[...live.bindings,...audience.bindings];
  if(request.method==="GET"&&!action){
    const statements=[db.prepare(`SELECT id,title,access_scope_id AS accessScopeId,file_count AS fileCount,total_bytes AS totalBytes,created_at AS createdAt,expires_at AS expiresAt,state,revision,
      (issuer_membership_id=(SELECT membership_id FROM account_space_actors WHERE device_id=?)) AS canIssue FROM delivery_snapshots WHERE ${guard}${id?" AND id=?":""} ORDER BY created_at DESC,id DESC LIMIT 100`).bind(owner.id,...values,...(id?[id]:[]))];
    if(id)statements.push(
      db.prepare(`SELECT item.media_id AS id,item.name,item.mime,item.size,item.sha256,item.source_revision AS sourceRevision,item.captured_at AS capturedAt,item.position FROM delivery_items item
        JOIN delivery_snapshots ON delivery_snapshots.id=item.delivery_id WHERE delivery_snapshots.id=? AND ${guard} ORDER BY item.position`).bind(id,...values),
      db.prepare(`SELECT recipient.id,recipient.email,recipient.accepted_at AS acceptedAt,recipient.revoked_at AS revokedAt FROM delivery_recipients recipient JOIN delivery_snapshots ON delivery_snapshots.id=recipient.delivery_id
        WHERE delivery_snapshots.id=? AND ${guard} ORDER BY recipient.email,recipient.id`).bind(id,...values));
    const [deliveries,items,recipients]=await db.batch(statements);
    if(id&&!deliveries.results.length)throw new ApiError(404,"This delivery is unavailable.");
    return Response.json({deliveries:deliveries.results,serverTime:Date.now(),...(id?{items:items.results,recipients:recipients.results}:{})});
  }
  if(request.method==="POST"&&!id){
    const input=await readJson(request,z.object({id:z.string().uuid(),title:z.string().max(120),accessScopeId:z.string().uuid().nullable(),expiresAt:z.number().int(),
      files:z.array(z.object({id:z.string().uuid(),revision:z.number().int().nonnegative()})).min(1).max(100),
      recipients:z.array(z.object({id:z.string().uuid(),email:z.string().email().max(320),token:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(20),
      confirmed:z.literal(true),confirmAudienceExpansion:z.literal(true)}));
    const recipients=await Promise.all(input.recipients.map(async recipient=>({id:recipient.id,email:recipient.email,tokenHash:await tokenHash(recipient.token)})));
    return Response.json(await createDeliveryDraft(db,owner,{...input,recipients}));
  }
  if(id&&action==="issue"&&request.method==="POST"){
    const input=await readJson(request,z.object({expectedRevision:z.number().int().nonnegative(),confirmed:z.literal(true),confirmAudienceExpansion:z.literal(true)}));
    return Response.json(await issueDelivery(db,owner,id,input.expectedRevision));
  }
  if(id&&!action&&request.method==="DELETE"){
    const input=await readJson(request,z.object({expectedRevision:z.number().int().nonnegative(),confirmed:z.literal(true)}));
    return Response.json(await revokeDelivery(db,owner,id,input.expectedRevision));
  }
  throw new ApiError(404,"This delivery action is unavailable.");
}
