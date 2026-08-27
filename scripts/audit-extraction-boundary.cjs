const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const renderer = read('src/north-star.jsx');
const preload = read('electron/north-star-preload.cjs');
const main = read('electron/main.cjs');
const migrationDir = path.join(root, 'electron', 'migrations-north-star');
const migrationFiles = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
const migrationSql = migrationFiles.map((name) => read(path.join('electron', 'migrations-north-star', name))).join('\n');
const forbiddenRendererImports = ['RecruiterOutreachView.jsx', 'VideoFactoryView', 'FollowThroughView', 'Academy', 'todayView.mjs', 'roadmapHierarchy.mjs'];
const legacyTables = ['projects', 'tasks', 'goals', 'check_ins', 'notes', 'briefings', 'outreach_contacts', 'outreach_opportunities', 'job_phone_assignments'];
const careerTables = ['user_profiles', 'master_resumes', 'job_opportunities', 'job_applications', 'job_application_documents', 'job_application_events', 'job_application_sessions', 'job_application_submission_evidence', 'application_queue_runs', 'application_queue_items', 'email_messages', 'email_chunks', 'email_job_links', 'job_detail_activity', 'job_follow_up_tasks'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(forbiddenRendererImports.every((entry) => !renderer.includes(entry)), 'North Star renderer contains a legacy surface');
assert(preload.includes('Object.entries(api).filter'), 'North Star preload does not filter the API');
assert(main.includes('const standaloneNorthStar = true'), 'North Star is not permanently standalone');
assert(main.includes("path.join(app.getPath('appData'), 'NorthStar')"), 'North Star user-data path is not isolated');
assert(main.includes('application-documents'), 'North Star application documents path is not isolated');
assert(careerTables.every((table) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(migrationSql)), 'North Star career migration evidence is incomplete');
assert(legacyTables.every((table) => !new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(migrationSql)), 'North Star migration path contains a legacy-only table');

process.stdout.write(`${JSON.stringify({ renderer: 'src/north-star.jsx', preload: 'electron/north-star-preload.cjs', migrationDir: 'electron/migrations-north-star', migrationFiles: migrationFiles.length, userDataPath: '%APPDATA%\\NorthStar', databasePath: '%APPDATA%\\NorthStar\\executive-coach.sqlite', careerTables, legacyTablesExcluded: legacyTables }, null, 2)}\n`);
