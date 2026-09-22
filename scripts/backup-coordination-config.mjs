// One public switch governs both the Worker receiver and the checked-out backup writer. Credentials
// never belong in this configuration; an enabled writer still requires its dedicated environment secret.
export function backupCoordinationVariables(configuration) {
  if (!configuration || Object.keys(configuration).join() !== 'enabled' || typeof configuration.enabled !== 'boolean') {
    throw new Error('Invalid public backup coordination configuration.');
  }
  return configuration.enabled ? { RELAY_BACKUP_COORDINATION_ENABLED: 'true' } : {};
}
