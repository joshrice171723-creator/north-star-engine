const fs = require('fs');
const path = require('path');

const APPLICATIONS_FOLDER_NAME = 'Job Applications';
const SELECTED_FOLDER_NAME = 'Selected';
const VERSIONS_FOLDER_NAME = 'Versions';

function safeSegment(value, fallback) {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return normalized || fallback;
}

function applicationExportDirectory(documentsPath, job = {}, applicationId = job.id || '') {
  const company = safeSegment(job.company, 'Unknown company');
  const role = safeSegment(job.roleTitle, 'Untitled role');
  const identity = safeSegment(applicationId, 'unassigned').replace(/[^A-Za-z0-9_-]/g, '-');
  return path.join(documentsPath, APPLICATIONS_FOLDER_NAME, `${company} - ${role} (${identity})`);
}

function applicationFilePaths(documentsPath, job, applicationId) {
  const folderPath = applicationExportDirectory(documentsPath, job, applicationId);
  return {
    folderPath,
    selectedDirectory: path.join(folderPath, SELECTED_FOLDER_NAME),
    versionsDirectory: path.join(folderPath, VERSIONS_FOLDER_NAME),
    versionsResumesDirectory: path.join(folderPath, VERSIONS_FOLDER_NAME, 'Resumes'),
    versionsCoverLettersDirectory: path.join(folderPath, VERSIONS_FOLDER_NAME, 'Cover Letters'),
    selectedResumePath: path.join(folderPath, SELECTED_FOLDER_NAME, 'Resume.pdf'),
    selectedCoverLetterPath: path.join(folderPath, SELECTED_FOLDER_NAME, 'Cover Letter.pdf'),
  };
}

function ensureApplicationFileStructure(documentsPath, job, applicationId) {
  const files = applicationFilePaths(documentsPath, job, applicationId);
  for (const directory of [files.selectedDirectory, files.versionsResumesDirectory, files.versionsCoverLettersDirectory]) fs.mkdirSync(directory, { recursive: true });
  return files;
}

function applicationExportFilename(document, extension, job = {}) {
  const kind = document?.documentType === 'cover_letter' ? 'Cover Letter' : 'Resume';
  const version = Number.isInteger(document?.version) ? document.version : 'latest';
  return `${safeSegment(job.company, 'Unknown company')} - ${safeSegment(job.roleTitle, 'Untitled role')} - ${kind} - v${version}.${extension}`;
}

module.exports = { applicationExportDirectory, applicationExportFilename, applicationFilePaths, ensureApplicationFileStructure, safeSegment };
