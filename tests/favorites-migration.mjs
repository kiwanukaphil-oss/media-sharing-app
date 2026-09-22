import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rehearseFavoritesUpgrade} from '../scripts/rehearse-favorites-upgrade.mjs';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
const sql=(await Promise.all(journal.filter(m=>m.idx<=20).map(m=>readFile(`drizzle/${m.tag}.sql`,'utf8')))).join('\n');
const result=await rehearseFavoritesUpgrade(sql);
assert.equal(result.existingTablesPreserved,25);assert.equal(result.emptyPersonalBookmarks,true);
assert.equal(result.restoreQuarantineVerified,true);assert.equal(result.remoteApplied,false);
console.log('PASS: favourites table is additive, empty, schema-reviewed and preserves restore quarantine.');
