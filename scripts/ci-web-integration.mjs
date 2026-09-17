import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'http://127.0.0.1:8787';
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
const modules = (await readdir('dist/server', { recursive: true }))
  .filter(path => path.endsWith('.js'))
  .sort((left, right) => left === 'index.js' ? -1 : right === 'index.js' ? 1 : left.localeCompare(right))
  .map(path => ({ type: 'ESModule', path: `dist/server/${path}` }));

// Run the actual production modules in workerd with disposable D1/R2 stores.
// Direct Miniflare avoids Wrangler's known proxy failures on unconsumed request bodies.
const emulator = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port: 8787,
  workers: [{
    name: 'relay-ci', modules, modulesRoot: 'dist/server',
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    d1Databases: ['DB'], r2Buckets: ['BUCKET'],
    ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...rule }) => [name, rule])),
  }],
}));
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
  for (const migration of ['0000_purple_chamber', '0001_late_beyonder', '0002_lush_karma']) {
    const sql = await readFile(`drizzle/${migration}.sql`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await database.prepare(statement.trim()).run();
    }
  }
  for (const name of ['transfer-integration', 'web-management', 'security-hardening']) await runIntegrationTest(name);
} finally {
  await emulator.dispose();
}
