const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPlainText, renderHtml } = require('../electron/jobs/application-documents.cjs');
test('document rendering is local, selectable text with no remote assets', () => { const html = renderHtml('resume', { headline: 'A & B', summary: [{ text: 'Grounded', evidenceIds: ['x'] }] }); assert.match(html, /Grounded/); assert.doesNotMatch(html, /https?:\/\//); assert.match(renderPlainText('resume', { headline: 'A & B' }), /A & B/); });
