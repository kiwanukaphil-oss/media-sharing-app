import { createCipheriv,createDecipheriv,createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const derive=promisify(scrypt);
const fields=['formatVersion','ledgerId','keyId','publicKey','salt','nonce','ciphertext','tag'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const associatedData=vault=>Buffer.from('relay-erasure-signing-vault-v1\n'+JSON.stringify({formatVersion:1,ledgerId:vault.ledgerId,keyId:vault.keyId,publicKey:vault.publicKey}));

function decodeField(value,length) {
  if(typeof value!=='string' || value.length>8192 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid recovery vault encoding.');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.toString('base64url')!==value || (length!==undefined && bytes.length!==length)) throw new Error('Invalid recovery vault encoding.');
  return bytes;
}

async function recoveryKey(password,salt) {
  if(typeof password!=='string' || password.length<20 || password.length>256 || password.trim().length<20)
    throw new Error('Use a unique recovery password of at least 20 characters.');
  return derive(password,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024});
}

// Use standard Ed25519 keys and authenticated AES-GCM encryption with fixed scrypt work parameters.
// Public identifiers/key are authenticated as associated data. The user's recovery password is never
// stored in the vault or its metadata; local operational storage must separately use Windows DPAPI.
export async function createErasureSigningVault(password) {
  const salt=randomBytes(16),nonce=randomBytes(12),key=await recoveryKey(password,salt);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const root={ledgerId:randomUUID(),keyId:randomUUID(),publicKey:publicKey.export({type:'spki',format:'pem'})};
  const privateDer=privateKey.export({type:'pkcs8',format:'der'});
  try {
    const vault={formatVersion:1,...root,salt:salt.toString('base64url'),nonce:nonce.toString('base64url')};
    const cipher=createCipheriv('aes-256-gcm',key,nonce); cipher.setAAD(associatedData(vault));
    const ciphertext=Buffer.concat([cipher.update(privateDer),cipher.final()]);
    return {root,privateKey,vault:{...vault,ciphertext:ciphertext.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')}};
  } finally {key.fill(0);privateDer.fill(0);}
}

// Decrypt only the bounded, exact supported envelope. Successful decryption must also reproduce the
// independently expected public root, so a different valid vault cannot silently replace signing custody.
export async function openErasureSigningVault(vault,password,expectedRoot) {
  if(!vault || Object.keys(vault).sort().join(',')!==[...fields].sort().join(',') || vault.formatVersion!==1 ||
      typeof vault.ledgerId!=='string' || !uuid.test(vault.ledgerId) || typeof vault.keyId!=='string' || !uuid.test(vault.keyId) ||
      typeof vault.publicKey!=='string' || vault.publicKey.length>1024 ||
      !expectedRoot || ['ledgerId','keyId','publicKey'].some(field=>vault[field]!==expectedRoot[field]))
    throw new Error('Recovery vault differs from the independent public root.');
  const salt=decodeField(vault.salt,16),nonce=decodeField(vault.nonce,12),tag=decodeField(vault.tag,16),ciphertext=decodeField(vault.ciphertext);
  if(ciphertext.length>4096) throw new Error('Recovery vault is too large.');
  const key=await recoveryKey(password,salt);
  let privateDer;
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,nonce); decipher.setAAD(associatedData(vault));decipher.setAuthTag(tag);
    privateDer=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    const privateKey=createPrivateKey({key:privateDer,type:'pkcs8',format:'der'});
    if(privateKey.asymmetricKeyType!=='ed25519' || createPublicKey(privateKey).export({type:'spki',format:'pem'})!==expectedRoot.publicKey)
      throw new Error('Recovered signing key differs from the public root.');
    return privateKey;
  } finally {key.fill(0);privateDer?.fill(0);}
}
