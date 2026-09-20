import { build } from 'esbuild';

// Produce reviewable public dashboard settings without printing or accepting a client secret.
const compiled = await build({ entryPoints: ['lib/auth0-config.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { auth0ApplicationSetup } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const origin = process.env.RELAY_APP_ORIGIN || 'https://relayalbums.com';
console.log(JSON.stringify(auth0ApplicationSetup(origin), null, 2));
console.log('These are planned integration URLs. Keep account sign-in disabled until session routes, tenant configuration and end-to-end tests are complete.');
