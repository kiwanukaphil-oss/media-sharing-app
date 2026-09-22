import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rehearseRestrictedUpgrade} from '../scripts/rehearse-restricted-upgrade.mjs';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
const sql=(await Promise.all(journal.filter(m=>m.idx<=20).map(m=>readFile(`drizzle/${m.tag}.sql`,'utf8')))).join('\n');
const result=await rehearseRestrictedUpgrade(sql);
assert.equal(result.existingTablesPreserved,25);assert.equal(result.scopeMigrationInventsNoGrants,true);
assert.equal(result.restoredTriggersVerified,true);assert.equal(result.restoreQuarantineVerified,true);assert.equal(result.remoteApplied,false);
console.log('PASS: restricted migration preserves existing columns, grants no new access and retains restored triggers/quarantine.');
