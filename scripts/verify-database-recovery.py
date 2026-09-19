"""Validate a D1 export in fresh local stores; never restore over the production database."""
from pathlib import Path
import json
import sqlite3
import subprocess
import sys
import uuid

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / '.sites-runtime/production-recovery.sql'
output = root / '.sites-runtime/recovery' / str(uuid.uuid4())
output.mkdir(parents=True)
database = sqlite3.connect(output / 'restored.sqlite')
database.executescript(source.read_text(encoding='utf-8'))
assert database.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert not database.execute('PRAGMA foreign_key_check').fetchall()
# Include organisation tables when present, while retaining verification of older recovery points.
tables = ['spaces', 'devices', 'invitations', 'media']
for name in ['albums', 'album_sections', 'album_media']:
    if database.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", (name,)).fetchone():
        tables.append(name)
counts = {name: database.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0] for name in tables}

# D1 exports interleave alphabetically sorted tables and rows; create all tables first for foreign keys.
dump = list(database.iterdump())
ordered = ['PRAGMA defer_foreign_keys=TRUE;']
ordered += [line for line in dump if line.startswith('CREATE TABLE')]
ordered += [line for line in dump if line.startswith('INSERT INTO')]
ordered += [line for line in dump if line.startswith(('CREATE INDEX', 'CREATE UNIQUE INDEX'))]
normalized = output / 'restore.sql'
normalized.write_text('\n'.join(ordered), encoding='utf-8')
database.close()
persist = root / '.wrangler/recovery' / output.name
command = ['node', '--import', './scripts/sites-env.mjs', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', str(persist)]
restored = subprocess.run(command + ['--file', str(normalized)], cwd=root, capture_output=True, text=True, encoding='utf-8')
assert restored.returncode == 0, 'D1 local restore failed; inspect the isolated restore SQL locally.'
query = 'SELECT ' + ', '.join('(SELECT COUNT(*) FROM ' + name + ') AS ' + name for name in tables)
checked = subprocess.run(command + ['--command', query, '--json'], cwd=root, capture_output=True, text=True, encoding='utf-8')
assert checked.returncode == 0, 'D1 restored row-count check failed.'
result = json.loads(checked.stdout)
assert result[0]['results'][0] == counts
(output / 'report.json').write_text(json.dumps({'integrity': 'ok', 'foreign_key_errors': 0, 'row_counts': counts, 'd1_restore': 'passed'}, indent=2), encoding='utf-8')
print('PASS: production export restored into isolated SQLite and D1; integrity, foreign keys and all table counts verified.')
