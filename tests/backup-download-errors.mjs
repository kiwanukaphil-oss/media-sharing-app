import assert from 'node:assert/strict';
import { restoreDownloadError } from '../scripts/backup-storage.mjs';

const capped = await restoreDownloadError(Response.json({ code: 'download_cap_exceeded', message: 'PRIVATE OBJECT AND TOKEN' }, { status: 403 }));
assert.equal(capped.message, 'Restore download failed (HTTP 403; download_cap_exceeded).');
const unknown = await restoreDownloadError(Response.json({ code: 'PRIVATE IDENTIFIER', message: 'PRIVATE TOKEN' }, { status: 403 }));
assert.equal(unknown.message, 'Restore download failed (HTTP 403).');
assert.equal((await restoreDownloadError(new Response('PRIVATE HTML', { status: 502 }))).message, 'Restore download failed (HTTP 502).');
console.log('PASS: restore failures expose actionable allowlisted codes without provider messages or private identifiers.');
