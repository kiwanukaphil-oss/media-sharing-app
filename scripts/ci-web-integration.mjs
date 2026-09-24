import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const port = Number(process.env.RELAY_TEST_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a loopback test port between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const servePreview = process.argv.includes('--serve');
const browserChecks = process.argv.includes('--browser');
const closureEntryChecks = process.argv.includes('--closure-entrypoints');
const closureTrackingChecks = process.argv.includes('--closure-tracking') || closureEntryChecks;
const storagePoolChecks = process.argv.includes('--storage-pool');
const accountAccessChecks = storagePoolChecks || process.argv.includes('--account-access') || closureTrackingChecks;
const backupCoordinationChecks = process.argv.includes('--backup-coordination');
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
const modules = (await readdir('dist/server', { recursive: true }))
  .filter(path => path.endsWith('.js'))
  .sort((left, right) => left === 'index.js' ? -1 : right === 'index.js' ? 1 : left.localeCompare(right))
  .map(path => ({ type: 'ESModule', path: `dist/server/${path}` }));

// Run the actual production modules in workerd with disposable D1/R2 stores.
// Direct Miniflare avoids Wrangler's known proxy failures on unconsumed request bodies.
const emulator = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port,
  workers: [{
    name: 'relay-ci', modules, modulesRoot: 'dist/server',
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    d1Databases: ['DB'], r2Buckets: ['BUCKET'],
    ...(accountAccessChecks ? { bindings: { AUTH0_ENABLED: 'true', AUTH0_ROLLOUT: 'open', AUTH0_DOMAIN: 'access.auth0.com',
      AUTH0_CLIENT_ID: 'access-test', AUTH0_CLIENT_SECRET: 'isolated-test-only', RELAY_APP_ORIGIN: 'https://localhost',
      AUTH0_RECOVERY_SECRET: 'a'.repeat(64), PERSONAL_STORAGE_BUDGET_BYTES: '2147483648',
      ...(storagePoolChecks ? {RELAY_STORAGE_POOL:JSON.stringify({spaceIds:['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],limitBytes:10})} : {}),
      ...(closureTrackingChecks ? {RELAY_CLOSURE_TRACKING_ENABLED:'true'} : {}) } } : {}),
    ...(backupCoordinationChecks ? {bindings:{RELAY_BACKUP_COORDINATION_ENABLED:'true',RELAY_BACKUP_COORDINATION_SECRET:'c'.repeat(64)}} : {}),
    ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...rule }) => [name, rule])),
    ...((servePreview || browserChecks) ? { assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true } } } : {}),
  }],
}));
// Each subprocess shares only the disposable emulator's origin, never production credentials.
function runIntegrationTest(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${name}.mjs`], {
      stdio: 'inherit', env: { ...process.env, RELAY_TEST_ORIGIN: origin },
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${name} failed (${code}).`)));
  });
}
try {
  await emulator.ready;
  const database = await emulator.getD1Database('DB');
  const migrations = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
  for (const migration of migrations) {
    const sql = await readFile(`drizzle/${migration.tag}.sql`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await database.prepare(statement.trim()).run();
    }
  }
  // The additive coordination schema is migration 0019; flags still select isolated activation.
  if(storagePoolChecks){const {verifyStoragePoolRoutes}=await import('../tests/storage-pool-routes.mjs');await verifyStoragePoolRoutes(database,(url,options)=>emulator.dispatchFetch(url,options));}
  else if (backupCoordinationChecks) {
    const {verifyBackupCoordinationRoute}=await import('../tests/backup-coordination-route.mjs');
    await verifyBackupCoordinationRoute(database,(url,options)=>emulator.dispatchFetch(url,options));
  } else if (servePreview) {
    console.log(`Isolated production preview ready at ${origin}; storage is discarded when stopped.`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else if (closureEntryChecks) {
    const {verifyClosureEntryPoints}=await import('../tests/closure-entrypoints.mjs');
    await verifyClosureEntryPoints(database,(url,options)=>emulator.dispatchFetch(url,options),origin);
  } else if (accountAccessChecks) {
    const { verifyAccountDeletion } = await import('../tests/account-deletion.mjs');
    await verifyAccountDeletion(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyAccountRecovery } = await import('../tests/account-recovery.mjs');
    await verifyAccountRecovery(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyAccountSpaceAccess } = await import('../tests/account-space-access.mjs');
    await verifyAccountSpaceAccess(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyTransferAuthority } = await import('../tests/transfer-authority.mjs');
    await verifyTransferAuthority(database);
    const { verifyPersonalSpaces } = await import('../tests/personal-spaces.mjs');
    await verifyPersonalSpaces(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyLegacyReconciliation } = await import('../tests/legacy-reconciliation.mjs');
    await verifyLegacyReconciliation(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifySpacePeople } = await import('../tests/space-people.mjs');
    await verifySpacePeople(database, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyPublications } = await import('../tests/publications.mjs');
    await verifyPublications(database, await emulator.getR2Bucket('BUCKET'), (url, options) => emulator.dispatchFetch(url, options));
    const { verifyReadOnlyBackup } = await import('../tests/backup-d1-readonly.mjs');
    await verifyReadOnlyBackup(database);
    const { verifyRecoveryRepair } = await import('../tests/recovery-repair-rehearsal.mjs');
    await verifyRecoveryRepair(database);
    if (closureTrackingChecks) {
      const {verifyClosureRequestCoverage}=await import('../tests/closure-request-coverage.mjs');
      await verifyClosureRequestCoverage(database);
      const {verifyClosureEntryPoints}=await import('../tests/closure-entrypoints.mjs');
      await verifyClosureEntryPoints(database,(url,options)=>emulator.dispatchFetch(url,options),origin);
    }
  } else if (process.argv.includes('--capacity')) {
    const { verifyLibraryCapacity } = await import('../tests/library-capacity.mjs');
    await verifyLibraryCapacity(database, origin);
  } else if (process.argv.includes('--security')) {
    const { verifySecurityHardening } = await import('../tests/security-hardening.mjs');
    await verifySecurityHardening(origin, (url, options) => emulator.dispatchFetch(url, options));
  } else if (browserChecks) {
    for (const name of ['album-library-browser', 'web-browser', 'device-access-browser', 'usability-browser', 'media-polish-browser', 'library-organisation-browser', 'album-sections-browser', 'account-browser', 'account-library-browser', 'workspace-navigation-browser', 'space-people-browser', 'publication-browser', 'retrieval-presentation-browser', 'editor-browser']) await runIntegrationTest(name);
  } else {
    for (const name of ['transfer-integration', 'web-management', 'device-permissions', 'library-organisation', 'album-sections']) await runIntegrationTest(name);
    const { verifySecurityHardening } = await import('../tests/security-hardening.mjs');
    await verifySecurityHardening(origin, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyReadOnlyBackup } = await import('../tests/backup-d1-readonly.mjs');
    await verifyReadOnlyBackup(database);
    const { verifyAuth0Transactions } = await import('../tests/auth0-transactions.mjs');
    await verifyAuth0Transactions(database);
    const { verifyAccountSessions } = await import('../tests/account-sessions.mjs');
    await verifyAccountSessions(database);
    const { verifySpaceMemberships } = await import('../tests/space-memberships.mjs');
    await verifySpaceMemberships(database);
  }
} finally {
  await emulator.dispose();
}
