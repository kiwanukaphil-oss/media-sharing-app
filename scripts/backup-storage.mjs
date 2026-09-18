import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';

export const operationsDirectory = resolve('.sites-runtime/operations');
export const backupBucketId = '6d377f58d5e7b62bae090c11';
export const backupPrefix = 'relay/';

// Capture subprocess output privately: Wrangler exports print signed URLs that must not enter job logs.
export function runPrivateCommand(executable, argumentsList, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, argumentsList, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Required local command could not start.')));
    child.on('close', code => code === 0 ? resolveResult(output) : reject(new Error(`Local command failed (exit ${code}); no private output logged.`)));
    child.stdin.end(input);
  });
}

export async function hashFile(path) {
  const sha256 = createHash('sha256');
  const sha1 = createHash('sha1');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk); sha1.update(chunk); size += chunk.length;
  }
  return { size, sha256: sha256.digest('hex'), sha1: sha1.digest('hex') };
}

export function validateFileDigest(actual, expected) {
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256.toLowerCase()) {
    throw new Error('File size or SHA-256 mismatch; recovery point cannot be marked verified.');
  }
}

export function validateKeyScope(allowed, role) {
  const expected = role === 'writer' ? ['writeFiles'] : ['listFiles', 'readFiles'];
  if (JSON.stringify([...allowed.capabilities].sort()) !== JSON.stringify(expected.sort()) ||
      allowed.buckets?.length !== 1 || allowed.buckets[0].id !== backupBucketId || allowed.namePrefix !== backupPrefix) {
    throw new Error('Backup credential scope differs from the approved least-privilege role.');
  }
}

function validateBackblazeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/\.(backblazeb2\.com|backblaze\.com)$/.test(url.hostname)) throw new Error('Unexpected storage API destination.');
  return url;
}

async function readStorageResponse(response) {
  if (!response.ok) throw new Error(`Backblaze request failed (HTTP ${response.status}); no success recorded.`);
  return response.json();
}

// Hosted runners receive role-specific secrets through their environment; local operators use Windows DPAPI.
export async function loadBackupCredential(role) {
  if (!['writer', 'reader'].includes(role)) throw new Error('Unknown backup role.');
  const variable = role === 'writer' ? 'B2_WRITER_KEY_JSON' : 'B2_READER_KEY_JSON';
  if (process.env[variable]) {
    let credential;
    try { credential = JSON.parse(process.env[variable]); } catch { throw new Error('Backup credential JSON is invalid.'); }
    if (!credential.applicationKeyId || !credential.applicationKey) throw new Error('Backup credential fields are missing.');
    return credential;
  }
  if (process.platform !== 'win32') throw new Error(`Required secret ${variable} is missing.`);
  const name = role === 'writer' ? 'relay-backup-upload-only' : 'relay-restore-read-only';
  const encrypted = await readFile(resolve(operationsDirectory, `${name}.dpapi`), 'utf8');
  const plaintext = await runPrivateCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'], encrypted);
  return JSON.parse(plaintext);
}

// Each use independently checks the effective permissions; the master key is never needed by either role.
export async function authorizeBackupRole(role) {
  const credential = await loadBackupCredential(role);
  const authorization = await readStorageResponse(await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${credential.applicationKeyId}:${credential.applicationKey}`).toString('base64')}` },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  }));
  const storage = authorization.apiInfo.storageApi;
  validateKeyScope(storage.allowed, role);
  validateBackblazeUrl(storage.apiUrl); validateBackblazeUrl(storage.downloadUrl);
  return { ...storage, token: authorization.authorizationToken };
}

export async function storageRequest(session, operation, parameters) {
  return readStorageResponse(await fetch(`${session.apiUrl}/b2api/v4/${operation}`, {
    method: 'POST', headers: { Authorization: session.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters), redirect: 'error', signal: AbortSignal.timeout(60000),
  }));
}

// Multipart uploads keep memory bounded and require only writeFiles; failed parts are left for operator review.
async function uploadMultipart(session, path, fileName, digest) {
  const started = await storageRequest(session, 'b2_start_large_file', {
    bucketId: backupBucketId, fileName, contentType: 'application/octet-stream',
    fileInfo: { sha256: digest.sha256, large_file_sha1: digest.sha1 },
    serverSideEncryption: { mode: 'SSE-B2', algorithm: 'AES256' },
  });
  const destination = await storageRequest(session, 'b2_get_upload_part_url', { fileId: started.fileId });
  validateBackblazeUrl(destination.uploadUrl);
  const partSha1Array = [];
  const partSize = 64 * 1024 * 1024;
  if (Math.ceil(digest.size / partSize) > 10000) throw new Error('File exceeds supported multipart size.');
  const source = await open(path, 'r');
  try {
    for (let offset = 0; offset < digest.size; offset += partSize) {
      const chunk = Buffer.allocUnsafe(Math.min(partSize, digest.size - offset));
      let filled = 0;
      while (filled < chunk.length) {
        const { bytesRead } = await source.read(chunk, filled, chunk.length - filled, offset + filled);
        if (!bytesRead) throw new Error('Source file changed during multipart upload.');
        filled += bytesRead;
      }
      const checksum = createHash('sha1').update(chunk).digest('hex');
      const part = await readStorageResponse(await fetch(destination.uploadUrl, {
        method: 'POST', headers: { Authorization: destination.authorizationToken,
          'Content-Length': String(chunk.length), 'X-Bz-Part-Number': String(partSha1Array.length + 1), 'X-Bz-Content-Sha1': checksum },
        body: chunk, redirect: 'error', signal: AbortSignal.timeout(900000),
      }));
      if (part.contentSha1 !== checksum || Number(part.contentLength) !== chunk.length) throw new Error('Uploaded part verification failed.');
      partSha1Array.push(checksum);
    }
  } finally { await source.close(); }
  return storageRequest(session, 'b2_finish_large_file', { fileId: started.fileId, partSha1Array });
}

// Require server-side encryption and explicit checksums; record immutable version IDs for future restores.
export async function uploadBackupFile(session, path, fileName) {
  if (!fileName.startsWith(backupPrefix)) throw new Error('Destination is outside the backup prefix.');
  const digest = await hashFile(path);
  let result;
  if (digest.size > 128 * 1024 * 1024) {
    result = await uploadMultipart(session, path, fileName, digest);
  } else {
    const destination = await storageRequest(session, 'b2_get_upload_url', { bucketId: backupBucketId });
    validateBackblazeUrl(destination.uploadUrl);
    result = await readStorageResponse(await fetch(destination.uploadUrl, {
      method: 'POST', headers: { Authorization: destination.authorizationToken,
        'Content-Type': 'application/octet-stream', 'Content-Length': String(digest.size),
        'X-Bz-File-Name': encodeURIComponent(fileName), 'X-Bz-Content-Sha1': digest.sha1,
        'X-Bz-Info-sha256': digest.sha256, 'X-Bz-Server-Side-Encryption': 'AES256' },
      body: createReadStream(path), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(900000),
    }));
    if (result.contentSha1 !== digest.sha1) throw new Error('Upload checksum acknowledgement mismatch.');
  }
  if (result.action !== 'upload' || result.fileName !== fileName || result.bucketId !== backupBucketId ||
      Number(result.contentLength) !== digest.size || result.serverSideEncryption?.mode !== 'SSE-B2') {
    throw new Error('Upload acknowledgement or encryption mismatch.');
  }
  return { fileId: result.fileId, fileName, ...digest };
}

// Download a pinned version rather than the latest name, then compare actual bytes with the recovery manifest.
export async function downloadBackupFile(session, record, destination) {
  if (!record.fileName.startsWith(backupPrefix)) throw new Error('Restore reference outside backup prefix.');
  const url = new URL('/b2api/v4/b2_download_file_by_id', session.downloadUrl);
  url.searchParams.set('fileId', record.fileId);
  const response = await fetch(url, { headers: { Authorization: session.token }, redirect: 'error', signal: AbortSignal.timeout(900000) });
  if (!response.ok) throw new Error(`Restore download failed (HTTP ${response.status}).`);
  if (decodeURIComponent(response.headers.get('x-bz-file-name') ?? '') !== record.fileName ||
      response.headers.get('x-bz-file-id') !== record.fileId) throw new Error('Restore returned a different object version.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  validateFileDigest(await hashFile(destination), record);
}
