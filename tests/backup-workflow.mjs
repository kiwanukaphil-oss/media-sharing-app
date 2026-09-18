import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const workflow = yaml.load(readFileSync('.github/workflows/daily-backup.yml', 'utf8'));

test('backup secrets cannot be reached by pull request or off-main entry jobs', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.match(workflow.jobs.inventory.if, /github\.repository == 'kiwanukaphil-oss\/media-sharing-app'/);
  assert.match(workflow.jobs.inventory.if, /github\.ref == 'refs\/heads\/main'/);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});

test('upload runner never receives the restore reader and verification never receives source or write access', () => {
  const copy = JSON.stringify(workflow.jobs.copy);
  const verify = JSON.stringify(workflow.jobs.verify);
  assert.doesNotMatch(copy, /B2_READER_KEY_JSON/);
  assert.doesNotMatch(verify, /B2_WRITER_KEY_JSON|CLOUDFLARE_D1_READ_TOKEN|R2_READ_SECRET_ACCESS_KEY/);
  assert.notEqual(workflow.jobs.copy.environment, workflow.jobs.verify.environment);
  assert.equal(workflow.jobs.verify.needs, 'copy');
  assert.equal(workflow.jobs.verify.steps.at(-1).name, 'Report verified success');
});

test('only encrypted inventory is uploaded and third-party actions are pinned', () => {
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].with.path, 'work/backup-index.enc');
  assert.equal(uploads[0].with['retention-days'], 1);
  for (const step of steps.filter(step => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
});
