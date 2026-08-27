const AUTONOMOUS_APPLICATION_STATES = Object.freeze([
  'queued', 'opening', 'detecting_form', 'creating_account', 'reusing_account', 'awaiting_activation',
  'filling_profile', 'answering_questions', 'uploading_documents', 'navigating_form', 'ready_to_submit',
  'submitting', 'verifying_confirmation', 'verifying_email_confirmation', 'submitted', 'needs_user_answer', 'blocked', 'failed',
]);
function assertAutonomousApplicationState(state) {
  if (!AUTONOMOUS_APPLICATION_STATES.includes(state)) throw new Error('Invalid autonomous application state.');
  return state;
}
module.exports = { AUTONOMOUS_APPLICATION_STATES, assertAutonomousApplicationState };
