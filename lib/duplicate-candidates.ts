import {z} from "zod";
import {ApiError,database,readJson,type ActiveDevice} from "./server";
import {resourceAudienceAuthority} from "./asset-scope-authority";

// Match only an accessible source ID and revision, never a caller-supplied hash. Candidate names
// stay within that exact space and audience; an owner role cannot probe restricted originals.
// Recorded fingerprints are hints until both original streams have been independently checked.
export async function readDuplicateCandidates(request:Request,device:ActiveDevice){
  const input=await readJson(request,z.object({id:z.string().uuid(),expectedRevision:z.number().int().nonnegative()}));
  const sourceAuthority=resourceAudienceAuthority(device,'m'),candidateAuthority=resourceAudienceAuthority(device,'candidate');
  const source=`SELECT m.id,m.name,m.size,m.sha256,m.revision,m.access_scope_id AS accessScopeId FROM media m WHERE m.id=? AND m.revision=? AND m.status='ready' AND m.archived_at IS NULL AND ${sourceAuthority.sql}`;
  const bindings=[input.id,input.expectedRevision,...sourceAuthority.bindings];
  const [selected,matches]=await database().batch([
    database().prepare(source).bind(...bindings),
    database().prepare(`WITH selected AS (${source}) SELECT candidate.id,candidate.name,candidate.size,candidate.sha256,candidate.revision,candidate.access_scope_id AS accessScopeId
      FROM media candidate JOIN selected ON candidate.access_scope_id IS selected.accessScopeId AND candidate.sha256=selected.sha256 AND candidate.size=selected.size
      WHERE candidate.id<>selected.id AND candidate.status='ready' AND candidate.archived_at IS NULL AND ${candidateAuthority.sql}
      ORDER BY candidate.id LIMIT 51`).bind(...bindings,...candidateAuthority.bindings),
  ]);
  if(selected.results.length!==1)throw new ApiError(409,'This file or your access changed. Refresh and select it again.');
  return Response.json({source:selected.results[0],candidates:matches.results.slice(0,50),hasMore:matches.results.length>50,
    evidence:'recorded-fingerprint-match',scope:'same-space-same-audience'});
}
