const { createProviderAdapter } = require('./provider.cjs');
module.exports = createProviderAdapter({ key: 'ashby', hosts: [/ashbyhq\.com$/i], urlPattern: /ashbyhq\.com/i, stepRules: [{ pattern: /your information|candidate/i, step: 'candidate' }, { pattern: /resume|questions|additional/i, step: 'questions' }, { pattern: /application received|thank you/i, step: 'confirmation' }] });
