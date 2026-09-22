import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rehearseDeliveryUpgrade} from '../scripts/rehearse-delivery-upgrade.mjs';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
for(const baseline of [20,25]){
  const sql=(await Promise.all(journal.filter(m=>m.idx<=baseline).map(m=>readFile(`drizzle/${m.tag}.sql`,'utf8')))).join('\n');
  const result=await rehearseDeliveryUpgrade(sql);
  assert.equal(result.existingTablesPreserved,baseline===20?25:34);
  assert.equal(result.noInvitationsCreated,true);assert.equal(result.restoredTriggersVerified,true);
  assert.equal(result.restoreQuarantineVerified,true);assert.equal(result.remoteApplied,false);
}
console.log('PASS delivery migration: supported baselines preserve existing rows, invent no grants and retain protective triggers after restore');
