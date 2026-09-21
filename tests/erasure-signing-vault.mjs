import assert from 'node:assert/strict';
import { randomBytes,sign,verify } from 'node:crypto';
import { createErasureSigningVault,openErasureSigningVault } from '../scripts/erasure-signing-vault.mjs';

const password=randomBytes(12).toString('base64url').slice(0,15);
const {vault,root}=await createErasureSigningVault(password);
const restored=await openErasureSigningVault(vault,password,root),challenge=randomBytes(32);
assert.equal(verify(null,challenge,root.publicKey,sign(null,challenge,restored)),true);
assert.equal(JSON.stringify(vault).includes(password),false);
assert.equal(JSON.stringify(vault).includes('PRIVATE KEY'),false);
assert.deepEqual(Object.keys(vault).sort(),['formatVersion','ledgerId','keyId','publicKey','salt','nonce','ciphertext','tag'].sort());
await assert.rejects(openErasureSigningVault(vault,randomBytes(32).toString('hex'),root));
for(const field of ['salt','nonce','ciphertext','tag']) {
  const bytes=Buffer.from(vault[field],'base64url');bytes[0]^=1;
  await assert.rejects(openErasureSigningVault({...vault,[field]:bytes.toString('base64url')},password,root));
}
for(const change of [{formatVersion:2},{extra:true},{nonce:vault.nonce+'='},{salt:'a'.repeat(10000)},{ciphertext:'x'.repeat(8193)}])
  await assert.rejects(openErasureSigningVault({...vault,...change},password,root));
for(const field of ['ledgerId','keyId','publicKey'])
  await assert.rejects(openErasureSigningVault(vault,password,{...root,[field]:'different'}),/root/);
const another=await createErasureSigningVault(password);
await assert.rejects(openErasureSigningVault(another.vault,password,root),/root/);
for(const invalid of ['', 'short', 'a'.repeat(14), ' '+ 'a'.repeat(14), ' '.repeat(30), 'a'.repeat(257)]) await assert.rejects(createErasureSigningVault(invalid),/password/);
console.log('PASS: encrypted signing-key recovery, independent public-root binding, wrong passwords, ciphertext/header tampering, bounded formats and no password/private PEM in vault.');
