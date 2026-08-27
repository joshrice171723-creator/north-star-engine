const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const sourceUserData = process.env.NORTH_STAR_SOURCE_USER_DATA || path.join(process.env.APPDATA || '', 'ClaudeArchitectStudyCoachNative');
const destinationUserData = process.env.NORTH_STAR_DESTINATION_USER_DATA || path.join(process.env.APPDATA || '', 'NorthStar');
const sourceDatabase = path.join(sourceUserData, 'executive-coach.sqlite');
const destinationDatabase = path.join(destinationUserData, 'executive-coach.sqlite');
const backupDir = path.resolve(__dirname, '..', 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDatabase = path.join(backupDir, `command-center-${stamp}.sqlite`);
const credentialFiles = ['openrouter-credentials.json', 'job-source-credentials.json', 'external-application-credentials.json', 'langsmith-credentials.json', 'email-credentials.json', 'gmail-oauth-client-credentials.json'];
const careerTables = new Set([
  'schema_migrations', 'user_settings', 'integrations_metadata', 'calendar_events', 'job_opportunities', 'user_profiles', 'master_resumes', 'job_search_runs', 'job_search_attempts', 'job_search_ranking_batches', 'api_call_log', 'job_applications', 'job_application_answers', 'job_application_events', 'job_application_documents', 'job_application_sessions', 'email_messages', 'email_chunks', 'email_job_links', 'email_sender_blocks', 'job_calendar_links', 'job_follow_up_tasks', 'job_detail_activity', 'job_application_external_accounts', 'job_application_unknown_questions', 'job_application_activation_attempts', 'job_application_submission_evidence', 'application_site_playbooks', 'application_playbook_steps', 'application_playbook_repairs', 'application_playbook_learning_retries', 'application_answer_policies', 'application_workflow_steps', 'application_queue_runs', 'application_queue_items'
]);

function copyAtomic(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, destination);
  return true;
}

async function main() {
  if (!fs.existsSync(sourceDatabase)) throw new Error(`Source database not found: ${sourceDatabase}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
  await source.backup(backupDatabase);
  source.close();
  fs.mkdirSync(destinationUserData, { recursive: true });
  copyAtomic(backupDatabase, destinationDatabase);
  const destination = new Database(destinationDatabase);
  destination.pragma('foreign_keys = OFF');
  const tables = destination.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  destination.transaction(() => {
    for (const table of tables) if (!careerTables.has(table)) destination.exec(`DROP TABLE IF EXISTS "${table.replaceAll('"', '""')}"`);
    const allowedMigrationFiles = new Set(fs.readdirSync(path.join(__dirname, '..', 'electron', 'migrations-north-star')));
    for (const row of destination.prepare('SELECT id FROM schema_migrations').all()) if (!allowedMigrationFiles.has(row.id)) destination.prepare('DELETE FROM schema_migrations WHERE id = ?').run(row.id);
  })();
  destination.pragma('foreign_keys = ON');
  const integrity = destination.pragma('integrity_check', { simple: true });
  const foreignKeys = destination.prepare('PRAGMA foreign_key_check').all();
  if (integrity !== 'ok' || foreignKeys.length) throw new Error(`Cloned database failed checks: integrity=${integrity}, foreignKeys=${foreignKeys.length}`);
  destination.close();
  for (const filename of credentialFiles) copyAtomic(path.join(sourceUserData, filename), path.join(destinationUserData, filename));
  copyAtomic(path.join(sourceUserData, 'master-resume.pdf'), path.join(destinationUserData, 'master-resume.pdf'));
  const sourceDocuments = path.join(sourceUserData, 'ApplicationDocuments');
  const destinationDocuments = path.join(destinationUserData, 'application-documents');
  if (fs.existsSync(sourceDocuments)) fs.cpSync(sourceDocuments, destinationDocuments, { recursive: true, force: false, errorOnExist: false });
  console.log(JSON.stringify({ sourceDatabase, backupDatabase, destinationDatabase, destinationUserData, tables: careerTables.size, credentialsCopied: credentialFiles.filter((name) => fs.existsSync(path.join(destinationUserData, name))), integrity, foreignKeys: foreignKeys.length }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
