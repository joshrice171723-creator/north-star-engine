'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPipelineLogger } = require('../electron/jobs/automation/pipeline-logger.cjs');

const tempDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `north-star-${label}-`));

test('pipeline logger appends sanitized JSONL entries', () => {
  const directory = tempDir('log');
  let clock = 0;
  const logger = createPipelineLogger({ directory, now: () => new Date(1700000000000 + (clock += 1)).toISOString() });
  assert.equal(logger.log({ event: 'stage_progress', applicationId: 'app-1', password: 'hunter2', nested: { apiKey: 'secret-value', stage: 'opening' } }), true);
  assert.equal(logger.log({ event: 'queue_item_finished', applicationId: 'app-1', state: 'applied' }), true);
  const lines = fs.readFileSync(logger.filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'stage_progress');
  assert.equal(lines[0].password, '[redacted]');
  assert.equal(lines[0].nested.apiKey, '[redacted]');
  assert.equal(lines[0].nested.stage, 'opening');
  assert.notEqual(lines[0].ts, lines[1].ts);
});

test('pipeline logger rotates the active file once maxBytes is exceeded', () => {
  const directory = tempDir('rotate');
  const rotations = [];
  const io = {
    appendFile: (file, data) => fs.appendFileSync(file, data),
    stat: () => 6 * 1024 * 1024,
    rename: (from, to) => rotations.push([from, to]),
  };
  const logger = createPipelineLogger({ directory, maxBytes: 5 * 1024 * 1024, now: () => '2026-08-25T00:00:00.000Z', io });
  logger.log({ event: 'x' });
  assert.equal(rotations.length, 1);
  assert.equal(rotations[0][0], logger.filePath);
  assert.equal(rotations[0][1], `${logger.filePath}.1`);
  assert.equal(JSON.parse(fs.readFileSync(logger.filePath, 'utf8')).event, 'x');
});

test('pipeline logger keeps working when stat fails on the first write', () => {
  const directory = tempDir('enoent');
  const writes = [];
  const io = {
    appendFile: (file, data) => writes.push(data),
    stat: () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
    rename: () => { throw new Error('rotation must not be attempted for ENOENT'); },
  };
  const logger = createPipelineLogger({ directory, now: () => 't', io });
  logger.log({ event: 'first' });
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).event, 'first');
});

test('pipeline logger degrades silently instead of throwing into the pipeline', () => {
  const directory = tempDir('broken');
  const io = {
    appendFile: () => { throw new Error('disk full'); },
    stat: () => { throw new Error('io exploded'); },
  };
  const logger = createPipelineLogger({ directory, io });
  assert.equal(logger.log({ event: 'x' }), false);
});

test('pipeline logger requires a directory', () => {
  assert.throws(() => createPipelineLogger({}), /A log directory is required/);
});