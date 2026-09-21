import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identityRuntimeVariables } from '../scripts/identity-runtime.mjs';

const configuration = JSON.parse(await readFile('deploy/identity-runtime.json', 'utf8'));
const variables = identityRuntimeVariables(configuration);
assert.equal(variables.AUTH0_ENABLED, String(configuration.enabled));
assert.equal(variables.PERSONAL_STORAGE_BUDGET_BYTES, String(configuration.personalStorageBudgetBytes));
assert.equal(variables.RELAY_APP_ORIGIN, 'https://relayalbums.com');
for (const invalid of [{ enabled: 'true' }, { domain: 'tenant.auth0.com.evil.example' }, { appOrigin: 'https://relayalbums.com/elsewhere' },
  { clientId: '' }, { personalStorageBudgetBytes: -1 }, { personalStorageBudgetBytes: 1.5 }, { clientSecret: 'must-not-enter-public-config' }]) {
  assert.throws(() => identityRuntimeVariables({ ...configuration, ...invalid }), /Invalid public/);
}
const enabled = identityRuntimeVariables({ ...configuration, enabled: true, personalStorageBudgetBytes: 10737418240 });
assert.equal(enabled.AUTH0_ENABLED, 'true');
assert.equal(enabled.PERSONAL_STORAGE_BUDGET_BYTES, '10737418240');
assert.ok(!Object.keys(enabled).some(key => /secret/i.test(key)));
console.log('PASS: explicit identity activation, fixed production origin, bounded allocation configuration and rejection of public secrets.');
