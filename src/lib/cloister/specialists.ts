/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

export { buildSpecialistBaseCommand, buildSpecialistCavemanExports } from './specialists-spawn.js';


export {
  REVIEWER_ROLES,
  getAllSpecialists,
  ensureProjectSpecialistDir,
  getProjectSpecialistDir,
  getReviewerSessionName,
  getSpecialistMetadata,
  getTmuxSessionName,
  initSpecialistsDirectory,
  isProjectSpecialistActivelyRunning,
  loadRegistry,
  makeSpecialistRegistryKey,
  parseReviewerSessionName,
  parseSpecialistRegistryKey,
  pruneSpecialistRegistryEntriesForIssue,
  recordWake,
  saveRegistry,
  updateSpecialistMetadata,
  type LegacySpecialistDefinition,
  type LegacySpecialistRuntimeStatus,
  type ProjectSpecialistMetadata,
  type ResolutionStep,
  type ReviewerRole,
  type SpecialistAgentName,
  type SpecialistRegistry,
} from './specialists-registry.js';

export {
  exitGracePeriod,
  findActiveRegistryKey,
  getGracePeriodState,
  pauseGracePeriod,
  resumeGracePeriod,
  signalSpecialistCompletion,
  startGracePeriod,
  terminateSpecialist,
  type GracePeriodState,
  type TaskContext,
} from './specialists-lifecycle.js';

export {
  disableSpecialist,
  enableSpecialist,
  getAllProjectSpecialistStatuses,
  getEnabledSpecialists,
  getProjectSpecialistMetadata,
  getRunMetadata,
  incrementProjectRunCount,
  isEnabled,
  listProjectsWithSpecialists,
  listSpecialistsForProject,
  setCurrentRun,
  updateContextTokens,
  updateProjectSpecialistMetadata,
  updateRunMetadata,
  updateRunStatus,
} from './specialists-project-meta.js';

export {
  countContextTokens,
  findSessionFile,
  getAllSpecialistStatus,
  getSpecialistState,
  getSpecialistStatus,
  initializeEnabledSpecialists,
  isInitialized,
  isRunning,
} from './specialists-status.js';

export {
  getFeedbackStats,
  getPendingFeedback,
  sendFeedbackToAgent,
  type SpecialistFeedback,
} from './specialists-feedback.js';
