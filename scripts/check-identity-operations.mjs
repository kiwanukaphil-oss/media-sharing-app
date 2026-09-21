import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';

import { identityOperationsQuery, evaluateIdentityOperations } from '../lib/identity-operations-monitor.mjs';
export { identityOperationsQuery, evaluateIdentityOperations };

export async function checkIdentityOperations() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('Read-only database credential is missing.');
  const source = JSON.parse(await readFile('deploy/cloudflare.json', 'utf8'));
  const issues = evaluateIdentityOperations(await queryReadOnlyDatabase(source, token, identityOperationsQuery));
  if (issues.length) throw new Error(issues.join(' '));
  console.log('PASS: deletion review queue and known recovery/session consistency. Provider event delivery is checked separately.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await checkIdentityOperations(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
