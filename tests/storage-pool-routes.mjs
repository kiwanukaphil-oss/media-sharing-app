import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/account-sessions.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const accounts=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settings={issuer:'https://access.auth0.com/',clientId:'access-test',clientSecret:'isolated-test-only',appOrigin:'https://localhost'};
export const poolSpaceIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
// Exercise built Worker reservations and storage disclosure with the real D1/R2 request boundary.
export async function verifyStoragePoolRoutes(db,dispatch){
 const now=Date.now(),login=await accounts.createAccountSession(db,settings,{issuer:settings.issuer,subject:'pool-owner',displayName:'Pool owner',authenticatedAt:Math.floor(now/1000)*1000,credentialsChangedAt:0,verifiedEmail:'pool@example.invalid'},null);
 const session=await accounts.readAccountSession(db,settings,login.token);
 for(const id of poolSpaceIds){await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(id,'Pool fixture',now).run();await db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(crypto.randomUUID(),session.personId,id,now).run();}
 await db.prepare('INSERT INTO personal_spaces VALUES(?,?,1)').bind(poolSpaceIds[0],session.personId).run();
 const request=async(space,path,method='GET',body)=>{const response=await dispatch(`https://localhost/api/${path}?space=${space}`,{method,headers:{Cookie:`__Host-relay_account=${login.token}`,Origin:settings.appOrigin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};};
 for(const space of poolSpaceIds)assert.equal((await request(space,'session')).status,200);
 const input=size=>({id:crypto.randomUUID(),name:'pool-fixture.bin',mime:'application/octet-stream',size,sha256:'a'.repeat(64),category:'original'});
 const attempts=await Promise.all(poolSpaceIds.map(space=>request(space,'uploads','POST',input(6))));
 assert.deepEqual(attempts.map(result=>result.status).sort(),[200,507]);
 for(const space of poolSpaceIds){const usage=await request(space,'storage');assert.equal(usage.status,200);assert.equal(usage.data.limit,10);assert.equal(usage.data.poolUsed,6);}
 await db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND person_id=?").bind(poolSpaceIds[1],session.personId).run();
 assert.equal((await request(poolSpaceIds[0],'storage')).data.poolUsed,undefined);
 assert.equal((await request(poolSpaceIds[1],'storage')).data.poolUsed,undefined);
 const last=await request(poolSpaceIds[1],'uploads','POST',input(4));assert.equal(last.status,200);
 assert.equal((await request(poolSpaceIds[0],'uploads','POST',input(1))).status,507);
 console.log('PASS: built Worker pooled personal/shared capacity, cross-space concurrent reservations and loss-of-common-owner privacy.');
}
