const { createProviderAdapter } = require('./provider.cjs');
module.exports = createProviderAdapter({ key: 'greenhouse', hosts: [/greenhouse\.io$/i], urlPattern: /greenhouse\.io/i, stepRules: [{ pattern: /candidate|personal|contact/i, step: 'candidate' }, { pattern: /resume|cover letter|upload/i, step: 'documents' }, { pattern: /application received|thank you/i, step: 'confirmation' }] });
