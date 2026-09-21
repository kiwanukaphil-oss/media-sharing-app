import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { operationsDirectory, runPrivateCommand } from './backup-storage.mjs';

const bucketName = 'relay-media-originals';
const endpoint = `https://5afd1facc45c9ddd86114155b09fc2e2.r2.cloudflarestorage.com/${bucketName}`;
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

export async function parseR2InventoryXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new Error('Inventory response exceeds its bound.');
  return JSON.parse(await runPrivateCommand(shell,['-NoProfile','-NonInteractive','-File',resolve('scripts/parse-r2-inventory.ps1')],xml));
}

function decodeObjectKey(value) {
  if (typeof value !== 'string' || !value) throw new Error('Inventory key is missing.');
  const key = decodeURIComponent(value);
  if (Buffer.byteLength(key) > 1024) throw new Error('Inventory key exceeds its bound.');
  return key;
}

// Both listing APIs are GET-only, fixed to the already authorised bucket. Metadata and signatures never
// enter console output; redirects and oversized responses are rejected before parsing.
export function createReadOnlyR2InventoryRequest(credential, request = fetch) {
  if (!credential?.accessKeyId || !credential.secretAccessKey) throw new Error('Existing R2 reader is required.');
  const client = new AwsClient({...credential,region:'auto',service:'s3'});
  return async (mode,cursor) => {
    if (!['objects','multipart'].includes(mode)) throw new Error('Unknown inventory operation.');
    const allowed = mode === 'objects' ? ['continuation-token'] : ['key-marker','upload-id-marker'];
    if (Object.keys(cursor).some(key => !allowed.includes(key))) throw new Error('Unexpected inventory cursor.');
    const url = new URL(endpoint);
    url.search = new URLSearchParams({...mode === 'objects' ? {'list-type':'2','max-keys':'1000'} : {uploads:'','max-uploads':'1000'},
      'encoding-type':'url',...cursor}).toString();
    const signed = await client.sign(url,{method:'GET'});
    const response = await request(signed,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Read-only R2 inventory rejected (HTTP ${response.status}).`);
    const decoder = new TextDecoder('utf-8',{fatal:true}); let size = 0, xml = '';
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('R2 inventory response exceeds its bound.');
      xml += decoder.decode(chunk,{stream:true});
    }
    return parseR2InventoryXml(xml + decoder.decode());
  };
}

// Exhaust objects and multipart uploads separately. Repeated keys/IDs/cursors and partial responses fail
// closed; a successful listing is still not a write freeze or permission to remove any object.
export async function inventoryR2Objects(request) {
  const objects = [], unfinishedUploads = [];
  for (const mode of ['objects','multipart']) {
    let cursor = {}; const seen = new Set(), cursors = new Set();
    for (let page = 0; ; page++) {
      if (page >= 200) throw new Error('R2 inventory capacity requires review.');
      const result = await request(mode,cursor);
      if (result?.root !== (mode === 'objects' ? 'ListBucketResult' : 'ListMultipartUploadsResult') ||
          result.bucket !== bucketName || result.encoding !== 'url' || !['true','false'].includes(result.truncated) ||
          !Array.isArray(result.objects) || !Array.isArray(result.uploads) ||
          (mode === 'objects' ? result.uploads.length !== 0 : result.objects.length !== 0)) throw new Error('Unexpected R2 inventory scope.');
      const rows = mode === 'objects' ? result.objects : result.uploads;
      if (rows.length > 1000 || (mode === 'objects' && (!/^\d+$/.test(result.keyCount ?? '') || Number(result.keyCount) !== rows.length)))
        throw new Error('Incomplete R2 inventory page.');
      for (const row of rows) {
        const key = decodeObjectKey(row.key), id = mode === 'objects' ? key : row.uploadId;
        if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('Duplicate or invalid R2 inventory record.');
        seen.add(id);
        if (mode === 'objects') {
          if (!/^\d+$/.test(row.size ?? '') || !Number.isSafeInteger(Number(row.size)) ||
              typeof row.etag !== 'string' || !row.etag || !Number.isFinite(Date.parse(row.modifiedAt))) throw new Error('Invalid R2 object metadata.');
          objects.push({key,size:Number(row.size),etag:row.etag,modifiedAt:row.modifiedAt});
        } else {
          if (!Number.isFinite(Date.parse(row.initiatedAt))) throw new Error('Invalid multipart metadata.');
          unfinishedUploads.push({key,uploadId:id,initiatedAt:row.initiatedAt});
        }
      }
      if (result.truncated === 'false') break;
      if (mode === 'objects') {
        if (typeof result.nextContinuationToken !== 'string' || !result.nextContinuationToken) throw new Error('Missing R2 continuation.');
        cursor = {'continuation-token':result.nextContinuationToken};
      } else {
        if (typeof result.nextUploadIdMarker !== 'string' || !result.nextUploadIdMarker) throw new Error('Missing multipart continuation.');
        cursor = {'key-marker':decodeObjectKey(result.nextKeyMarker),'upload-id-marker':result.nextUploadIdMarker};
      }
      const cursorKey = JSON.stringify(cursor);
      if (cursors.has(cursorKey)) throw new Error('R2 inventory cursor did not advance.');
      cursors.add(cursorKey);
    }
  }
  const data = {objects,unfinishedUploads};
  return {formatVersion:1,bucketName,mode:'review-only',executable:false,listingComplete:true,atomicSnapshot:false,
    fingerprint:createHash('sha256').update(JSON.stringify(data)).digest('hex'),...data};
}

export async function loadR2InventoryCredential() {
  const sealed = await readFile(resolve(operationsDirectory,'hosted-r2.dpapi'),'utf8');
  const raw = await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  return JSON.parse(raw);
}

// Reuse the Windows-encrypted source reader; no key creation, permission expansion, upload or deletion.
async function saveR2Inventory() {
  const inventory = await inventoryR2Objects(createReadOnlyR2InventoryRequest(await loadR2InventoryCredential()));
  const directory = resolve(operationsDirectory,'r2-inventories');
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,`${Date.now()}-${randomUUID()}.json`),JSON.stringify({...inventory,generatedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'private-r2-inventory-saved',objects:inventory.objects.length,
    unfinishedUploads:inventory.unfinishedUploads.length,executable:false}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await saveR2Inventory(); }
  catch { console.error('R2 inventory incomplete; no removal authority recorded. Review source-reader access privately.'); process.exitCode=1; }
}
