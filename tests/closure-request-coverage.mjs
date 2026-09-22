import assert from 'node:assert/strict';

// Inspect the journal produced by real account/upload/publication routes in the built Worker.
// This verifies request injection, not complete metadata coverage or readiness for production fencing.
export async function verifyClosureRequestCoverage(database) {
  const admissions=(await database.prepare('SELECT * FROM closure_write_admissions').all()).results;
  assert.ok(admissions.length>0);
  assert.ok(admissions.some(row=>row.kind==='account' && row.state==='settled'));
  assert.ok(admissions.some(row=>row.state==='uncertain'),'Failed requests remain reviewable.');
  assert.ok(admissions.every(row=>row.state!=='active'),'Every awaited request has a terminal journal outcome.');
  const effects=(await database.prepare('SELECT * FROM closure_storage_effects').all()).results;
  for(const operation of ['put','multipart_create','multipart_part','multipart_complete','delete'])
    assert.ok(effects.some(row=>row.operation===operation),`Actual routes tracked ${operation}`);
  assert.ok(effects.filter(row=>row.operation==='multipart_part').every(row=>row.part_number>0 && row.upload_id));
  assert.equal(await database.prepare(`SELECT e.id FROM closure_storage_effects e LEFT JOIN closure_write_admissions w
    ON w.id=e.admission_id WHERE w.id IS NULL OR (w.state='settled' AND e.state<>'acknowledged') LIMIT 1`).first(),null);
  console.log('PASS: built-Worker request storage injection, multipart part custody and terminal admission accounting.');
}
