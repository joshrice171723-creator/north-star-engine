'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeTraceValue } = require('./trace-store.cjs');

// One rotated JSONL file keeps post-mortems possible without unbounded disk
// growth: every entry is a single sanitized JSON line, and once the active
// file passes maxBytes it is renamed to `<name>.1` (replacing the previous
// generation) so at most two files ever exist.
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function createPipelineLogger({ directory, fileName = 'pipeline-diagnostics.log', maxBytes = DEFAULT_MAX_BYTES, now = () => new Date().toISOString(), io = {} } = {}) {
  if (!directory) throw new Error('A log directory is required.');
  const filePath = path.join(directory, fileName);
  const rotatedPath = `${filePath}.1`;
  const appendLine = io.appendFile || ((file, data) => fs.appendFileSync(file, data));
  const rotate = io.rename || ((from, to) => fs.renameSync(from, to));
  const sizeOf = io.stat ? () => io.stat(filePath) : (file) => fs.statSync(file).size;
  let rotationBroken = false;
  function log(entry = {}) {
    try {
      if (!rotationBroken) {
        try {
          if (sizeOf() > maxBytes) rotate(filePath, rotatedPath);
        } catch (error) {
          // A missing active file is normal on first write; anything else means
          // rotation cannot be trusted, so stop trying rather than throwing
          // diagnostics errors into the pipeline itself.
          if (error?.code !== 'ENOENT') rotationBroken = true;
        }
      }
      appendLine(filePath, `${JSON.stringify(sanitizeTraceValue({ ts: now(), ...entry }))}\n`);
      return true;
    } catch { return false; }
  }
  return { log, filePath, rotatedPath };
}

module.exports = { createPipelineLogger, DEFAULT_MAX_BYTES };