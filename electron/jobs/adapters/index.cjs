const generic = require('./generic.cjs');
const providerAdapters = [require('./dice.cjs'), require('./adzuna.cjs'), require('./greenhouse.cjs'), require('./lever.cjs'), require('./workday.cjs'), require('./ashby.cjs'), require('./smartrecruiters.cjs'), require('./icims-taleo.cjs')];
const adapters = [generic, ...providerAdapters];
function selectAdapter(context = {}) {
  // Provider rules are deliberately opt-in until each live provider has passed
  // its fixture and controlled production validation; generic remains the safe default.
  if (context.enableProviderAdapters !== true) return generic;
  const matches = providerAdapters.filter((adapter) => adapter.matches(context));
  return matches.length === 1 ? matches[0] : generic;
}
function boundedDiagnostic(input = {}) { return { adapterKey: String(input.adapterKey || 'generic').slice(0, 80), adapterVersion: Number(input.adapterVersion) || 1, operation: String(input.operation || 'observe').slice(0, 80), outcome: String(input.outcome || 'unknown').slice(0, 80), reasonCode: String(input.reasonCode || '').slice(0, 120), durationMs: Math.max(0, Math.min(Number(input.durationMs) || 0, 300000)) }; }
module.exports = { adapters, providerAdapters, selectAdapter, boundedDiagnostic };
