import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const port = Number(process.env.RELAY_TEST_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a loopback test port between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const servePreview = process.argv.includes('--serve');
const browserChecks = process.argv.includes('--browser');
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
  if (servePreview) {
    console.log(`Isolated production preview ready at ${origin}; storage is discarded when stopped.`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else if (process.argv.includes('--capacity')) {
    const { verifyLibraryCapacity } = await import('../tests/library-capacity.mjs');
    await verifyLibraryCapacity(database, origin);
  } else if (process.argv.includes('--security')) {
    const { verifySecurityHardening } = await import('../tests/security-hardening.mjs');
    await verifySecurityHardening(origin, (url, options) => emulator.dispatchFetch(url, options));
  } else if (browserChecks) {
    for (const name of ['web-browser', 'device-access-browser', 'usability-browser', 'media-polish-browser', 'library-organisation-browser', 'album-sections-browser']) await runIntegrationTest(name);
  } else {
    for (const name of ['transfer-integration', 'web-management', 'device-permissions', 'library-organisation', 'album-sections']) await runIntegrationTest(name);
    const { verifySecurityHardening } = await import('../tests/security-hardening.mjs');
    await verifySecurityHardening(origin, (url, options) => emulator.dispatchFetch(url, options));
    const { verifyReadOnlyBackup } = await import('../tests/backup-d1-readonly.mjs');
    await verifyReadOnlyBackup(database);
  }
} finally {
  await emulator.dispose();
}
