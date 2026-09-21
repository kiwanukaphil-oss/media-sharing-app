import { open,readFile,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Only one authorised operator host currently holds operational signing custody. All its publishing
// entry points share this exclusive lock. A crashed process leaves the lock for explicit inspection;
// elapsed time never permits a second signer to take over. This is not a distributed signing lease.
export async function withErasureWriterLock(directory,action) {
  const path=resolve(directory,'writer.lock'),ownership=JSON.stringify({nonce:randomUUID(),pid:process.pid,createdAt:Date.now()});
  let file;
  try {file=await open(path,'wx',0o600);} catch {throw new Error('Erasure writer is locked; inspect the existing operation before retrying.');}
  try {await file.writeFile(ownership);await file.sync();return await action();}
  finally {
    await file.close();
    if(await readFile(path,'utf8')!==ownership) throw new Error('Erasure writer lock ownership changed; retained for review.');
    await unlink(path);
  }
}
