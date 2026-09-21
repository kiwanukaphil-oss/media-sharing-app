import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';

import { providerOrigin, recoveryPeopleQuery, inspectAuth0Recovery, RecoveryMonitorError } from '../lib/provider-recovery-monitor.mjs';
export { providerOrigin, recoveryPeopleQuery, inspectAuth0Recovery };
const fail = message => { throw new RecoveryMonitorError(message); };

// Run only after a dedicated least-privilege client is authorised; the web sign-in secret must never be reused.
async function runRecoveryMonitor() {
  if (!process.env.CLOUDFLARE_API_TOKEN) fail('Read-only database credential is missing.');
  const source = JSON.parse(await readFile('deploy/cloudflare.json', 'utf8'));
  const people = await queryReadOnlyDatabase(source, process.env.CLOUDFLARE_API_TOKEN, recoveryPeopleQuery);
  const issues = await inspectAuth0Recovery(people, { clientId: process.env.AUTH0_MONITOR_CLIENT_ID, clientSecret: process.env.AUTH0_MONITOR_CLIENT_SECRET });
  if (issues.length) fail(issues.join(' '));
  console.log('PASS: retained provider failure window and current active-account password-change reconciliation.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runRecoveryMonitor(); }
  catch (error) {
    console.error(error instanceof RecoveryMonitorError ? error.message : 'Recovery monitoring could not complete; inspect provider and database access privately.');
    process.exitCode = 1;
  }
}
