import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';

// Exercise the real built route under workerd, including public rate limiting, private errors and the
// dedicated HMAC boundary. Fixture activation is confined to the disposable local D1 environment.
export async function verifyBackupCoordinationRoute(database,dispatch) {
  const url='http://127.0.0.1:8787/api/operations/backup-coordination';
  const command={action:'begin',id:randomUUID(),snapshotId:`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`};
  const send=async(value,overrides={})=>{
    const body=JSON.stringify(value),timestamp=String(Date.now());
    return dispatch(url,{method:'POST',body,headers:{'Content-Type':'application/json',
      'X-Relay-Backup-Time':timestamp,'X-Relay-Backup-Signature':createHmac('sha256','c'.repeat(64))
        .update(`relay-backup-coordination-v1.${timestamp}.${body}`).digest('hex'),...overrides}});
  };
  assert.equal((await dispatch(url)).status,403);
  assert.equal((await send(command,{'X-Relay-Backup-Signature':'d'.repeat(64)})).status,403);
  assert.equal((await send(command,{Origin:'https://relayalbums.com'})).status,403);
  assert.equal((await send({...command,personId:'forbidden'})).status,403);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM closure_write_admissions').first()).n,0);
  const admitted=await send(command);
  assert.equal(admitted.status,200);
  assert.equal(admitted.headers.get('Cache-Control'),'no-store');
  assert.ok(admitted.headers.get('X-Request-ID'));
  assert.equal((await admitted.json()).state,'active');
  assert.equal((await send(command)).status,200);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM closure_write_admissions').first()).n,1);
  const completed={...command,action:'settle',outcome:'settled',receiptDigest:'e'.repeat(64)};
  assert.equal((await send(completed)).status,200);
  assert.equal((await send(completed)).status,200);
  const replay=await send(command);
  assert.equal(replay.status,409);
  assert.equal(replay.headers.get('Cache-Control'),'no-store');
  assert.equal((await database.prepare('SELECT state FROM closure_write_admissions').first()).state,'settled');
  console.log('PASS: real Worker backup coordinator route, dedicated proof, browser/invalid-scope denial, private responses, stable admission and terminal settlement. Isolated only.');
}
