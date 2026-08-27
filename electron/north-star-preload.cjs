const { contextBridge } = require('electron');
const { createDesktopShellApi } = require('./preload.cjs');

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
contextBridge.exposeInMainWorld('desktopShell', Object.fromEntries(
  Object.entries(api).filter(([name]) => !legacyOnlyApi.has(name))
));
