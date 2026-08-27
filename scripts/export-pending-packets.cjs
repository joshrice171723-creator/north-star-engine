#!/usr/bin/env node
'use strict';

// Export one folder per job application that has NOT yet made it through the
// pipeline (submitted/applied) but already has a selected resume and selected
// cover letter. Each packet folder contains exactly three items:
//   <Company> - <Role>.txt   (the job URL plus role context)
//   Resume.<ext>             (copy of the selected resume)
//   Cover Letter.<ext>       (copy of the selected cover letter)
//
// Usage: node scripts/export-pending-packets.cjs [--db <sqlite>] [--out <dir>]
// Read-only against the database; only writes inside --out.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const options = { db: process.env.NORTH_STAR_DB || '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db') options.db = argv[++index] || '';
    else if (argv[index] === '--out') options.out = argv[++index] || '';
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  return options;
}

function defaultDatabasePath() {
  const appData = process.env.APPDATA || process.env.HOME || '';
  return appData ? path.join(appData, 'ClaudeArchitectStudyCoachNative', 'executive-coach.sqlite') : 'executive-coach.sqlite';
}

const sanitizeName = (value) => String(value || '')
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[.\s]+|[.\s]+$/g, '')
  .slice(0, 80) || 'Untitled';

function uniqueFolderPath(root, baseName) {
  let candidate = path.join(root, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(root, `${baseName} (${suffix++})`);
  return candidate;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const databasePath = options.db || defaultDatabasePath();
  // Packets land beside the repository by default so they never mix with source.
  const outputRoot = options.out || path.resolve(__dirname, '..', '..', 'job-application-packets');
  fs.mkdirSync(outputRoot, { recursive: true });

  let sqlite;
  try { sqlite = new Database(databasePath, { readonly: true, fileMustExist: true }); }
  catch (error) { console.error(`Could not open ${databasePath} read-only: ${error.message}`); process.exitCode = 2; return; }

  try {
    const rows = sqlite.prepare(`
      SELECT j.company, j.role_title, j.url, j.canonical_url,
             a.id AS application_id, a.status AS application_status,
             a.selected_resume_path, a.selected_cover_letter_path
      FROM job_applications a
      JOIN job_opportunities j ON j.id = a.job_id
      WHERE a.deleted_at IS NULL
        AND a.status <> 'submitted'
        AND j.stage = 'ready'
    `).all();

    let created = 0;
    let skipped = [];
    for (const row of rows) {
      const resumePath = String(row.selected_resume_path || '');
      const coverLetterPath = String(row.selected_cover_letter_path || '');
      if (!resumePath || !coverLetterPath) { skipped.push([row.company, 'missing selected document path']); continue; }
      if (!fs.existsSync(resumePath)) { skipped.push([row.company, `resume file missing: ${resumePath}`]); continue; }
      if (!fs.existsSync(coverLetterPath)) { skipped.push([row.company, `cover letter file missing: ${coverLetterPath}`]); continue; }

      const folder = uniqueFolderPath(outputRoot, `${sanitizeName(row.company)} - ${sanitizeName(row.role_title)}`);
      fs.mkdirSync(folder, { recursive: true });
      fs.copyFileSync(resumePath, path.join(folder, `Resume${path.extname(resumePath) || '.pdf'}`));
      fs.copyFileSync(coverLetterPath, path.join(folder, `Cover Letter${path.extname(coverLetterPath) || '.pdf'}`));
      const url = row.url || row.canonical_url || '(no URL recorded)';
      fs.writeFileSync(path.join(folder, `${sanitizeName(row.company)} - ${sanitizeName(row.role_title)}.txt`),
        `${row.company || 'Unknown employer'}\n${row.role_title || 'Untitled role'}\nStatus: awaiting submission\n\nURL:\n${url}\n`);
      created += 1;
      console.log(`Packet created: ${folder}`);
    }

    for (const [company, reason] of skipped) console.log(`Skipped ${company}: ${reason}`);
    console.log(`\nDone. ${created} packet(s) written to ${outputRoot}; ${skipped.length} skipped.`);
  } finally { sqlite.close(); }
}

main();