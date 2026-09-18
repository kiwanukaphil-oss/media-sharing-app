import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';

const schemaFilter = "sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'";
export const schemaQuery = `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE ${schemaFilter} ORDER BY type,name`;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const canonicalSchema = rows => JSON.stringify(rows.map(({ type, name, tbl_name, sql }) =>
  ({ type, name, tbl_name, sql })).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)));

// Serialize in SQLite to retain 64-bit integers, binary data, and embedded zero bytes in text.
function sqlValue(column) {
  return `CASE typeof(${column}) WHEN 'text' THEN 'CAST(X''' || hex(${column}) || ''' AS TEXT)' ` +
    `WHEN 'real' THEN CASE WHEN abs(${column})<=1.7976931348623157e308 THEN printf('%!.26g',${column}) ELSE NULL END ` +
    `ELSE quote(${column}) END`;
}

// Derive columns from the live schema locally; unsupported table shapes fail before any data request.
export function planReadOnlySnapshot(schema) {
  if (!Array.isArray(schema) || !schema.length || schema.length > 200 || schema.some(row =>
    !['table', 'index', 'view', 'trigger'].includes(row.type) || typeof row.sql !== 'string' || /CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql))) {
    throw new Error('Unsupported backup schema.');
  }
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    const tables = schema.filter(row => row.type === 'table');
    for (const table of tables) database.exec(table.sql);
    const selections = tables.map(table => {
      const columns = database.prepare(`PRAGMA table_xinfo(${identifier(table.name)})`).all();
      if (!columns.length || columns.some(column => column.hidden !== 0)) throw new Error('Generated or hidden columns require backup review.');
      const names = columns.map(column => column.name);
      if (!/\bWITHOUT\s+ROWID\b/i.test(table.sql)) {
        const rowId = ['rowid', '_rowid_', 'oid'].find(name => !names.some(column => column.toLowerCase() === name));
        if (!rowId) throw new Error('Shadowed row identifiers require backup review.');
        names.unshift(rowId);
      }
      return { name: table.name, names };
    });
    const hasSequence = Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get());
    if (hasSequence) selections.push({ name: 'sqlite_sequence', names: ['name', 'seq'] });
    const tableQueries = selections.map(({ name, names }) => {
      const prefix = `INSERT INTO ${identifier(name)} (${names.map(identifier).join(',')}) VALUES (`;
      const statement = `${literal(prefix)} || ${names.map(column => sqlValue(identifier(column))).join(" || ',' || ")} || ');'`;
      return `json_object('name',${literal(name)},'count',(SELECT count(*) FROM ${identifier(name)}),` +
        `'rows',json((SELECT json_group_array(${statement}) FROM ${identifier(name)})))`;
    });
    const sql = `SELECT json_object('schema',json((SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM sqlite_schema WHERE ${schemaFilter})),` +
      `'tables',json_array(${tableQueries.join(',')})) AS snapshot`;
    if (Buffer.byteLength(sql) > 90000) throw new Error('Backup query exceeds its safe size limit.');
    return { schema, selections, hasSequence, sql };
  } finally { database.close(); }
}

// Validate the complete atomic response and restore locally before accepting SQL as a recovery snapshot.
export function restoreReadOnlySnapshot(plan, result) {
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0].snapshot !== 'string') throw new Error('Incomplete snapshot response.');
  const snapshot = JSON.parse(result[0].snapshot);
  if (canonicalSchema(snapshot.schema) !== canonicalSchema(plan.schema)) throw new Error('Schema changed during snapshot planning.');
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== plan.selections.length) throw new Error('Incomplete snapshot tables.');
  const statements = [];
  for (const [position, expected] of plan.selections.entries()) {
    const table = snapshot.tables[position];
    if (table.name !== expected.name || !Number.isSafeInteger(table.count) || table.count < 0 ||
        !Array.isArray(table.rows) || table.rows.length !== table.count || table.rows.some(row => typeof row !== 'string')) {
      throw new Error('Incomplete snapshot rows or unsupported values.');
    }
    if (table.name === 'sqlite_sequence') statements.push('DELETE FROM sqlite_sequence;');
    statements.push(...table.rows);
  }
  const sql = [...plan.schema.filter(row => row.type === 'table').map(row => `${row.sql};`), ...statements,
    ...plan.schema.filter(row => row.type !== 'table').map(row => `${row.sql};`)].join('\n');
  const restored = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    restored.exec(sql);
    if (restored.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok') ||
        restored.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Read-only snapshot integrity check failed.');
    for (const table of snapshot.tables) {
      if (restored.prepare(`SELECT count(*) AS n FROM ${identifier(table.name)}`).get().n !== table.count) throw new Error('Restored row count mismatch.');
    }
    return sql;
  } finally { restored.close(); }
}

// Bound memory consumption and reject error/truncated responses without exposing private API diagnostics.
export async function queryReadOnlyDatabase(source, token, sql, request = fetch) {
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${source.account_id}/d1/database/${source.database_id}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Read-only database query failed (HTTP ${response.status}).`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw new Error('Snapshot response exceeds 8 MiB; review export architecture before growth.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid database response.'); }
  const result = data.result?.[0];
  if (data.success !== true || data.result?.length !== 1 || result?.success !== true || !Array.isArray(result.results) ||
      result.meta?.changed_db !== false || result.meta?.rows_written !== 0) throw new Error('Database read verification failed.');
  return result.results;
}

export async function exportReadOnlyDatabase(source, destination) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('Database read credential is missing.');
  const plan = planReadOnlySnapshot(await queryReadOnlyDatabase(source, token, schemaQuery));
  const sql = restoreReadOnlySnapshot(plan, await queryReadOnlyDatabase(source, token, plan.sql));
  await writeFile(destination, sql, { flag: 'wx', mode: 0o600 });
}
