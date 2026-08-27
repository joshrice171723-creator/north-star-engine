'use strict';

const crypto = require('node:crypto');

function bounded(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function makeIdempotencyKey({ applicationId, checkpointVersion = 0, actionType, targetFingerprint } = {}) {
  const values = [bounded(applicationId), Number.isInteger(checkpointVersion) && checkpointVersion >= 0 ? checkpointVersion : 0, bounded(actionType, 80), bounded(targetFingerprint, 240)];
  if (!values[0] || !values[2] || !values[3]) throw new Error('Application, action type, and target fingerprint are required for idempotency.');
  const digest = crypto.createHash('sha256').update(values.join('|')).digest('hex').slice(0, 32);
  return `application-step-${digest}`;
}

module.exports = { makeIdempotencyKey };
