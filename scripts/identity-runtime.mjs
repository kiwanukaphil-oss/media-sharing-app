// Only public configuration belongs in this file. Secrets remain in Worker secret bindings.
// Explicit defaults prevent a deployment from accidentally enabling identity or promising unbudgeted storage.
export function identityRuntimeVariables(configuration) {
  const fields = ['enabled', 'domain', 'clientId', 'appOrigin', 'personalStorageBudgetBytes'];
  if (!configuration || Object.keys(configuration).some(key => !fields.includes(key)) ||
      typeof configuration.enabled !== 'boolean' || typeof configuration.domain !== 'string' ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+auth0\.com$/i.test(configuration.domain) ||
      typeof configuration.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(configuration.clientId) ||
      configuration.appOrigin !== 'https://relayalbums.com' || !Number.isSafeInteger(configuration.personalStorageBudgetBytes) ||
      configuration.personalStorageBudgetBytes < 0) {
    throw new Error('Invalid public identity runtime configuration. Never put credentials in this file.');
  }
  return { AUTH0_ENABLED: String(configuration.enabled), AUTH0_DOMAIN: configuration.domain.toLowerCase(),
    AUTH0_CLIENT_ID: configuration.clientId, RELAY_APP_ORIGIN: configuration.appOrigin,
    PERSONAL_STORAGE_BUDGET_BYTES: String(configuration.personalStorageBudgetBytes) };
}
