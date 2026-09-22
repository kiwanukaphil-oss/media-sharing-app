const tables=['delivery_snapshots','delivery_items','delivery_recipients'];

// Inventory exact issuer and accepted-recipient identities without treating matching contact
// email as ownership. Deliveries reference originals and create no additional stored byte copies.
export function inspectDeliverySnapshot(database,personId){
  const names=new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  const present=tables.filter(name=>names.has(name));
  const report={present:present.length>0,complete:present.length===0||present.length===tables.length};
  if(!report.present||!report.complete)return {...report,snapshots:[],recipients:[]};
  const snapshots=database.prepare(`SELECT id,space_id,issuer_membership_id,state,revoked_at FROM delivery_snapshots
    WHERE issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=?) ORDER BY id`).all(personId);
  const recipients=database.prepare(`SELECT id,delivery_id,accepted_by,revoked_at FROM delivery_recipients WHERE accepted_by=?
    OR delivery_id IN(SELECT id FROM delivery_snapshots WHERE issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)) ORDER BY id`).all(personId,personId);
  return {...report,snapshots,recipients};
}

// Snapshot-only minimisation runs inside its caller's transaction. Sender erasure removes captured
// labels and recipient contacts, but never another person's original. Recipient erasure revokes only
// that recipient's grant; email matching removes a stored contact without conferring byte ownership.
export function minimiseDeliveryIdentity(database,personId,email,now){
  const inventory=inspectDeliverySnapshot(database,personId);
  if(!inventory.complete)throw new Error('Incomplete delivery schema requires review.');
  if(!inventory.present)return;
  const issuedBy=`SELECT id FROM delivery_snapshots WHERE issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)`;
  database.prepare(`UPDATE delivery_snapshots SET state='revoked',revoked_at=COALESCE(revoked_at,?),revision=revision+1,
    title='Deleted delivery',sender_name='Deleted member',intent_hash='erased-delivery:' || id WHERE id IN(${issuedBy})`).run(now,personId);
  database.prepare(`UPDATE delivery_recipients SET revoked_at=COALESCE(revoked_at,?),email='',token_hash='erased-delivery-recipient:' || id
    WHERE accepted_by=? OR delivery_id IN(${issuedBy}) OR (?<>'' AND lower(email)=lower(?))`).run(now,personId,personId,email,email);
  database.prepare(`DELETE FROM delivery_items WHERE delivery_id IN(${issuedBy})`).run(personId);
}
