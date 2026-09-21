import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { reportIdentityHealth as reportCore } from '../lib/identity-health-report.mjs';
export const reportIdentityHealth = (environment = process.env, request = fetch, now = Date.now()) => reportCore(environment, request, now);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await reportIdentityHealth(); console.log('Identity monitoring status recorded.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
