const { createProviderAdapter } = require('./provider.cjs');
module.exports = createProviderAdapter({ key: 'lever', hosts: [/lever\.co$/i], urlPattern: /lever\.co/i, stepRules: [{ pattern: /personal information|contact/i, step: 'candidate' }, { pattern: /additional information|resume|cover letter/i, step: 'questions' }, { pattern: /thank you|application received/i, step: 'confirmation' }] });
