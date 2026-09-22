import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';

// Install only the isolated prototype's new schema in disposable Miniflare D1. Production migrations
// are deliberately unchanged; use SQLite's parsed schema to preserve complete trigger statements.
export async function installDeliveryTestSchema(database){
  if(await database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='delivery_snapshots'").first())return;
  const source=new DatabaseSync(':memory:');
  try{
    for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)source.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
    const before=new Set(source.prepare('SELECT name FROM sqlite_schema').all().map(row=>row.name));
    if(source.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='delivery_snapshots'").get())throw new Error('Apply the complete journal before running delivery tests.');
    source.exec(await readFile('docs/prototypes/delivery-schema.sql','utf8'));
    const additions=source.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all().filter(row=>!before.has(row.name));
    for(const addition of additions)await database.prepare(addition.sql).run();
  }finally{source.close();}
}
