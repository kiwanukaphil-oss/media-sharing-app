# Coordinated backup activation

Prepared 22 September 2026. Activate only global backup admission; account closure tracking and deletion execution remain disabled.

## Exact change

Migration `0019_wild_nighthawk.sql` adds four empty protocol tables and their constraints/indexes. It does not edit existing rows or infer account closure. The former prototype is retained as a comparison/removal candidate; never apply it over migration 0019.

`deploy/backup-coordination.json` is the single public activation switch for both the Worker and the checked-out backup writer. It is now configured for activation (`enabled: true`); deployment and first coordinated evidence are tracked below. When enabled, the backup job requires its dedicated `RELAY_BACKUP_COORDINATION_SECRET`; missing credentials stop before export or upload. The existing D1 reader and B2 writer/reader permissions remain separate. The coordinator capability can only admit/settle global backup runs; it cannot read library contents, erase data or clear fences.

Completion receipts are archived before settlement. Independently verify one using:

```powershell
node --disable-warning=ExperimentalWarning scripts/read-live-backup-completion.mjs <snapshot-id>
```

This uses existing D1/B2 readers and compares exact immutable versions against live coordinator state. Private evidence stays under ignored operations storage. It does not use the coordinator secret as its trust source.

## Checklist

- [x] Review backup-only schema minimisation; refuse account/device/fence/storage-effect references pending their separate disposition review.
- [x] Generate migration 0019 from the checked-in Drizzle schema; validate legacy upgrade, constraints, actual D1/R2 protocol tests, restore quarantine and minimisation.
- [x] Rehearse against a fresh private production export: all 21 existing application tables unchanged, four new tables empty, integrity/relationships and restored-access quarantine verified. Source hash `7bb18d8ce8e950241b229013eeeff3a8e24126f88e4923f4d527090dffbd8e7e`.
- [x] Complete fresh independent recovery run `35702440856`: snapshot `2026-09-22T08-00-57-472Z-89f00ca6-b73b-488c-b2ae-9ce8f940f2ad`, 25 originals, 321,680,743 bytes, all 25 reused and independently restored.
- [x] Pass TypeScript, full lint/build, actual built-Worker coordinator and enabled-tracking suites. No production activation yet.
- [x] Hosted CI `35702718797` passed verification and browser jobs for source `436af67`.
- [x] Apply migration 0019 and independently verify the fresh post-change export at 08:09 UTC: all 21 existing tables unchanged, all four new tables empty. Private bookmark/export evidence retained.
- [x] Install the dedicated random coordinator secret via stdin into the existing Worker and protected `relay-backup-copy` environment; encrypted local custody retained, no values logged. No existing data-reader/writer permissions were broadened.
- [ ] Enable the common public switch, deploy and verify unauthenticated coordinator rejection and ordinary production health.
- [ ] Run a coordinated hosted backup, independently restore originals, retrieve archived receipt against live D1, and confirm no non-backup protocol state was created.

## Recovery boundaries

The schema is additive and remains present if application code is rolled back. Keep account closure tracking disabled. An interrupted or ambiguous run stays active/uncertain and requires review; disabling coordination is not evidence that earlier writers stopped. Restored historical active runs become uncertain. The current backup-only minimisation review rejects any snapshot containing account closure references. No general account-closure completion is claimed by this activation.
