import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {schemaQuery,planReadOnlySnapshot,restoreReadOnlySnapshot,queryReadOnlyDatabase} from '../scripts/backup-d1-readonly.mjs';

// Exercise exact SQLite storage values, explicit row identifiers, schema objects, and deleted sequence history.
function createExportFixture() {
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT, value, other TEXT);
 CREATE TABLE child(parent INTEGER REFERENCES entries(id));
 CREATE INDEX value_index ON entries(other);
 CREATE VIEW entry_view AS SELECT id FROM entries;
 CREATE TRIGGER entry_trigger AFTER INSERT ON child BEGIN SELECT 1; END;
 INSERT INTO entries(value,other) VALUES(9223372036854775807,CAST(X'610062' AS TEXT)),(X'00FF','quote''line'),(1.2345678901234567,NULL),(NULL,'');
 INSERT INTO entries(id) VALUES(900); DELETE FROM entries WHERE id=900;
 INSERT INTO child(rowid,parent) VALUES(77,1);`);
 return db;
}

test('read-only logical snapshot preserves types, bytes, rowids, schema and sequence',()=>{
 const source=createExportFixture();
 const target=new DatabaseSync(':memory:', {enableForeignKeyConstraints:false});
 try {
  const plan=planReadOnlySnapshot(source.prepare(schemaQuery).all());
  target.exec(restoreReadOnlySnapshot(plan,source.prepare(plan.sql).all()));
  const query="SELECT id,typeof(value) AS kind,hex(value) AS bytes,hex(other) AS text_bytes FROM entries ORDER BY id";
  assert.deepEqual(target.prepare(query).all(),source.prepare(query).all());
  assert.equal(target.prepare('SELECT rowid FROM child').get().rowid,77);
  assert.equal(target.prepare('SELECT value FROM entries WHERE id=3').get().value,source.prepare('SELECT value FROM entries WHERE id=3').get().value);
  target.exec('INSERT INTO entries DEFAULT VALUES');
  assert.equal(target.prepare('SELECT max(id) AS id FROM entries').get().id,901);
  assert.equal(target.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type IN ('index','view','trigger')").get().n,3);
 } finally {source.close();target.close();}
});

test('schema changes, missing rows, unsupported values and generated columns fail closed',()=>{
 const source=createExportFixture();
 try {
  const plan=planReadOnlySnapshot(source.prepare(schemaQuery).all());
  const result=source.prepare(plan.sql).all();
  const payload=JSON.parse(result[0].snapshot);
  payload.tables[0].rows.pop();
  assert.throws(()=>restoreReadOnlySnapshot(plan,[{snapshot:JSON.stringify(payload)}]),/Incomplete/);
  source.exec('ALTER TABLE entries ADD COLUMN later TEXT');
  assert.throws(()=>restoreReadOnlySnapshot(plan,source.prepare(plan.sql).all()),/Schema changed/);
  source.exec('CREATE TABLE generated(a,b AS (a+1))');
  assert.throws(()=>planReadOnlySnapshot(source.prepare(schemaQuery).all()),/hidden/);
 } finally {source.close();}
});

test('nonfinite real values cannot silently become null in a backup',()=>{
 const source=new DatabaseSync(':memory:');
 try {
  source.exec('CREATE TABLE numbers(value); INSERT INTO numbers VALUES(1e999)');
  const plan=planReadOnlySnapshot(source.prepare(schemaQuery).all());
  assert.throws(()=>restoreReadOnlySnapshot(plan,source.prepare(plan.sql).all()),/unsupported/);
 } finally {source.close();}
});

test('query client rejects failed, truncated, oversized and mutating responses',async()=>{
 const source={account_id:'account',database_id:'database'};
 const execute=response=>queryReadOnlyDatabase(source,'test','SELECT 1',async()=>response);
 await assert.rejects(execute(new Response('{}',{status:401})),/HTTP 401/);
 await assert.rejects(execute(new Response('{')),/Invalid/);
 await assert.rejects(execute(new Response('x'.repeat(8*1024*1024+1))),/8 MiB/);
 await assert.rejects(execute(Response.json({success:true,result:[{success:true,results:[],meta:{changed_db:true,rows_written:1}}]})),/verification/);
 assert.deepEqual(await execute(Response.json({success:true,result:[{success:true,results:[{ok:1}],meta:{changed_db:false,rows_written:0}}]})),[{ok:1}]);
});


// Empty tables and composite keys must survive without inventing implicit row identifiers.
test('empty and WITHOUT ROWID tables restore accurately',()=>{
 const source=new DatabaseSync(':memory:');
 const target=new DatabaseSync(':memory:');
 try {
  source.exec("CREATE TABLE empty(value); CREATE TABLE composite(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO composite VALUES('key',4)");
  const plan=planReadOnlySnapshot(source.prepare(schemaQuery).all());
  target.exec(restoreReadOnlySnapshot(plan,source.prepare(plan.sql).all()));
  assert.equal(target.prepare('SELECT count(*) AS n FROM empty').get().n,0);
  assert.deepEqual(target.prepare('SELECT * FROM composite').all(),source.prepare('SELECT * FROM composite').all());
 } finally {source.close();target.close();}
});
