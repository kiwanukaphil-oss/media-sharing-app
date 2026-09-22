import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled=await build({entryPoints:['lib/collaboration-policy.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {reviewSharedAction}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const actor={kind:'account',id:'membership-current',spaceId:'shared',role:'contributor',active:true};
const own={spaceId:'shared',audienceAllowed:true,membershipId:actor.id,deviceId:'device'};
const others={...own,membershipId:'another-membership',deviceId:'other-device'};
assert.equal(reviewSharedAction(actor,'edit-files',[own]).allowed,true);
assert.equal(reviewSharedAction(actor,'edit-files',[own,others]).allowed,false);
assert.equal(reviewSharedAction({...actor,id:'rejoined-membership'},'edit-files',[own]).allowed,false);
assert.equal(reviewSharedAction({...actor,role:'member'},'edit-files',[own]).allowed,false,'Existing Member must not gain Contributor editing.');
assert.equal(reviewSharedAction({...actor,role:'member'},'cancel-upload',[own]).allowed,true);
for(const role of ['owner','editor','contributor','viewer','member']) {
  assert.equal(reviewSharedAction({...actor,role,active:false},'read',[own]).allowed,false);
  assert.equal(reviewSharedAction({...actor,role},'read',[{...own,spaceId:'private'}]).allowed,false);
  assert.equal(reviewSharedAction({...actor,role},'read',[{...own,audienceAllowed:false}]).allowed,false);
  assert.equal(reviewSharedAction({...actor,role},'trash-files',[]).allowed,false);
}
assert.equal(reviewSharedAction({...actor,role:'editor'},'edit-files',[others]).allowed,true);
assert.equal(reviewSharedAction({...actor,role:'editor'},'manage-access').allowed,false);
assert.equal(reviewSharedAction({...actor,role:'editor'},'delete-permanently',[own]).allowed,false);
assert.equal(reviewSharedAction({...actor,role:'viewer'},'upload').allowed,false);
assert.equal(reviewSharedAction({...actor,role:'OWNER'},'read').allowed,false);
assert.equal(reviewSharedAction(actor,'unrecognised-action',[own]).allowed,false);
assert.equal(reviewSharedAction({...actor,kind:'legacy',role:'editor'},'read',[own]).allowed,false);
const legacy={kind:'legacy',id:'device',spaceId:'shared',role:'member',active:true};
// Byte-producing operations retain exact contribution ownership even for administrators. Demotion
// to Viewer stops continuation and preview creation; mixed selections never gain partial authority.
for (const action of ['continue-upload','create-preview']) {
  for (const role of ['owner','editor','contributor','viewer','member']) {
    assert.equal(reviewSharedAction({...actor,role},action,[own]).allowed,role!=='viewer');
    assert.equal(reviewSharedAction({...actor,role},action,[others]).allowed,false);
    assert.equal(reviewSharedAction({...actor,role},action,[own,others]).allowed,false);
    assert.equal(reviewSharedAction({...actor,role},action,[]).allowed,false);
    assert.equal(reviewSharedAction({...actor,role,id:'rejoined-membership'},action,[own]).allowed,false);
  }
  for (const role of ['owner','member']) {
    assert.equal(reviewSharedAction({...legacy,role},action,[own]).allowed,true);
    assert.equal(reviewSharedAction({...legacy,role},action,[others]).allowed,false);
  }
}
assert.equal(reviewSharedAction(legacy,'cancel-upload',[own]).allowed,true);
assert.equal(reviewSharedAction(legacy,'cancel-upload',[own,others]).allowed,false);
assert.equal(reviewSharedAction(legacy,'trash-files',[own]).allowed,false);
console.log('PASS: prepared shared-role policy denies mixed/cross-space/rejoined/revoked access, preserves legacy Member limits and prevents Editor administration. Database integration must also enforce current authority.');
