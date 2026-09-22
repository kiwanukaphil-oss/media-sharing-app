const protocolTables = ['closure_fences', 'closure_write_admissions', 'closure_storage_effects', 'closure_backup_runs'];

// Report retained protocol references without changing a snapshot or treating historical state as
// present-day storage evidence. In particular, a snapshot can contain its own active backup admission.
export function inspectClosureSnapshot(database) {
  const names = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
  const present = protocolTables.filter(name => names.has(name));
  const report = { present: present.length > 0, complete: present.length === protocolTables.length,
    missingTables: present.length ? protocolTables.filter(name => !names.has(name)) : [],
    minimisationReviewed: false, quiescenceProven: false, cutoverAllowed: false };
  if (!report.complete) return report;
  const fences = database.prepare('SELECT * FROM closure_fences ORDER BY id').all();
  const admissions = database.prepare('SELECT * FROM closure_write_admissions ORDER BY id').all();
  const effects = database.prepare('SELECT * FROM closure_storage_effects ORDER BY id').all();
  const backups = database.prepare('SELECT * FROM closure_backup_runs ORDER BY id').all();
  const linkedPeople = database.prepare(`SELECT a.device_id,m.person_id FROM account_space_actors a
    JOIN space_memberships m ON m.id=a.membership_id
    UNION SELECT c.device_id,m.person_id FROM legacy_owner_claims c
    JOIN space_memberships m ON m.id=c.membership_id`).all();
  const admissionReferences = admissions.map(admission => ({ ...admission,
    personIds: admission.kind === 'account' ? [admission.person_id] : admission.kind === 'legacy'
      ? [...new Set(linkedPeople.filter(link => link.device_id === admission.device_id).map(link => link.person_id))].sort() : [],
    globalScope: admission.kind === 'backup',
    unresolved: admission.state !== 'settled' }));
  const admissionIds = new Set(admissions.map(row => row.id));
  return { ...report, fences, admissions: admissionReferences, effects, backups,
    unresolvedAdmissionIds: admissionReferences.filter(row => row.unresolved).map(row => row.id),
    unresolvedEffectIds: effects.filter(row => row.state !== 'acknowledged').map(row => row.id),
    unboundLegacyAdmissionIds: admissionReferences.filter(row => row.kind === 'legacy' && row.personIds.length === 0).map(row => row.id),
    orphanEffectIds: effects.filter(row => !admissionIds.has(row.admission_id)).map(row => row.id),
    orphanBackupIds: backups.filter(row => !admissionIds.has(row.id)).map(row => row.id) };
}
