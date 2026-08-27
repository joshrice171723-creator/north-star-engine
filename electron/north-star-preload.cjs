const { contextBridge, ipcRenderer } = require('electron');
// Tell the shared factory not to expose its legacy-compatible bridge while it
// is being imported for this filtered standalone bridge.
process.__NORTH_STAR_PRELOAD__ = true;
const { createDesktopShellApi } = require('./preload.cjs');
delete process.__NORTH_STAR_PRELOAD__;

// This is an allow-by-default career bridge with an explicit legacy denylist.
// The source API remains shared for compatibility, while the standalone
// renderer cannot see Academy, roadmap, Video Factory, outreach, or Google
// Voice capabilities.
const legacyOnlyApi = new Set([
  'createVideoFactoryDraft', 'createVideoFactoryTestVideo', 'discoverVideoFactorySources',
  'createVideoFactoryResearchVideo', 'approveVideoFactoryResearchVideo',
  'listVideoFactoryVideos', 'listVideoFactoryPipeline', 'updateVideoFactoryPipeline',
  'openVideoFactoryFolder', 'deleteVideoFactoryVideo', 'navigateAcademy',
  'captureAcademyPage', 'getAcademyCaptures', 'deleteAcademyCapture',
  'getAcademyStudyMaterials', 'generateAcademyFlashcards', 'deleteAcademyStudyMaterial',
  'getAcademyStudyReviews', 'setAcademyStudyReview', 'setAcademyVisible', 'setAcademyBounds',
  'coachBootstrap', 'syncRoadmap', 'importRoadmap', 'saveNote', 'backupDatabase',
  'listProjects', 'listWorkspaces', 'createWorkspace', 'updateWorkspace', 'deleteWorkspace',
  'createProject', 'updateProject', 'deleteProject', 'listTasks', 'createTask',
  'updateTask', 'deleteTask', 'listOutreach', 'listOutreachContacts', 'saveOutreachContact',
  'createOutreachOpportunity', 'updateOutreach', 'approveOutreach', 'sendOutreach',
  'recordOutreachReply', 'listOutreachFollowups', 'getOutreachMetrics',
  'discoverOutreachContacts', 'getGoogleVoiceStatus', 'setGoogleVoiceEnabled',
  'openGoogleVoice', 'setGoogleVoiceVisible', 'testGoogleVoiceNotification',
  'onGoogleVoiceNotification', 'onAppBack'
]);

const api = createDesktopShellApi();
const filteredApi = Object.fromEntries(
  Object.entries(api).filter(([name]) => !legacyOnlyApi.has(name))
);
// Keep the critical standalone career path explicit even if Electron changes
// how a shared preload module is initialized.
filteredApi.getJobProfile = () => ipcRenderer.invoke('jobs:profile:get');
filteredApi.saveJobProfile = (input) => ipcRenderer.invoke('jobs:profile:save', input);
filteredApi.listJobs = () => ipcRenderer.invoke('coach:jobs:list');
filteredApi.createJob = (input) => ipcRenderer.invoke('coach:jobs:create', input);
filteredApi.updateJob = (input) => ipcRenderer.invoke('coach:jobs:update', input);
filteredApi.updateJobStage = (input) => ipcRenderer.invoke('coach:jobs:update-stage', input);
filteredApi.searchJobs = (input) => ipcRenderer.invoke('jobs:search', input?.nativeEvent ? {} : input);
filteredApi.uploadMasterResume = () => ipcRenderer.invoke('jobs:resume:upload');
filteredApi.getMasterResumePdf = () => ipcRenderer.invoke('jobs:resume:pdf');
contextBridge.exposeInMainWorld('desktopShell', filteredApi);
