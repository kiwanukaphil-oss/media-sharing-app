import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rehearseInvitationUpgrade} from '../scripts/rehearse-invitation-upgrade.mjs';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
const sql=(await Promise.all(journal.filter(m=>m.idx<20).map(m=>readFile(`drizzle/${m.tag}.sql`,'utf8')))).join('\n')+`
INSERT INTO spaces(id,name,created_at) VALUES('space','Preserved library',1);
INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES('person','https://fixture.invalid','subject','Owner','owner@example.invalid',1);
INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES('member','person','space','editor',1);
INSERT INTO person_invitations(id,token_hash,space_id,created_by,email,created_at,expires_at) VALUES('invite','hash','space','member','guest@example.invalid',1,9999999999999);`;
const result=await rehearseInvitationUpgrade(sql);
assert.equal(result.existingTablesPreserved,25);
assert.equal(result.existingInvitationsPreserveMember,true);
assert.equal(result.restoreQuarantineVerified,true);
assert.equal(result.remoteApplied,false);
console.log('PASS: additive invitation role preserves all prior table columns/rows, old Member grants and restore quarantine.');
