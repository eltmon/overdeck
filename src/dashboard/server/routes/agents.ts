import { getHeaderFromMap, validateOrigin } from './origin-validation.js';
import {
  buildPermissionActivityDetails,
  buildPermissionWaitingMessage,
  normalizePermissionRequestBody,
  parsePermissionResponseBehavior,
  permissionResolutionVerb,
  processPermissionResponse,
} from './agent-permissions.js';
import { getOverdeckHome } from '../../../lib/paths.js';
/**
 * Agents route module — Effect HttpRouter.Layer (PAN-428 B7)
 *
 * Implements all /api/agents/* endpoints from the Express server:
 *   GET    /api/agents
 *   GET    /api/agents/:id/output
 *   POST   /api/agents/:id/message
 *   POST   /api/agents/:id/tell
 *   DELETE /api/agents/:id
 *   GET    /api/agents/:id/health-history
 *   POST   /api/agents/:id/poke
 *   GET    /api/agents/:id/pending-questions
 *   POST   /api/agents/:id/answer-question
 *   POST   /api/agents/:id/heartbeat
 *   GET    /api/agents/:id/activity
 *   GET    /api/agents/:id/files
 *   GET    /api/agents/:id/timeline
 *   POST   /api/agents/:id/suspend
 *   POST   /api/agents/:id/resume
 *   GET    /api/agents/:id/cloister-health
 *   GET    /api/agents/:id/handoff/suggestion
 *   POST   /api/agents/:id/handoff
 *   GET    /api/agents/:id/cost
 *   POST   /api/agents/:id/reset-session
 *   POST   /api/agents
 */

import { readdir, readFile, rename, rm, stat, symlink, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { DomainEvent } from '@overdeck/contracts';
import type { Role } from '@overdeck/contracts';
import { bodyToEvent, decodeDomainEvent } from '../services/agent-event-utils.js';

import {
  getAgentStateSync,
  getAgentRuntimeStateSync,
  getAgentRuntimeState,
  deliverAgentPermissionDecision,
  saveAgentRuntimeState,
  saveAgentState,
  setAgentPaused,
  clearAgentPaused,
  clearAgentTroubled,
  markAgentStoppedState,
  type AgentRuntimeState,
  type AgentState,
  getActivity,
  saveSessionId,
  getSessionId,
  messageAgent,
  deliverAgentMessage,
  stopAgentSync,
  stopAgent,
  listRunningAgentsSync,
  normalizeAgentId,
  listAgentStates,
} from '../../../lib/agents.js';
import { stopWorkspaceDocker } from '../../../lib/workspace-manager.js';
import { getProviderForModelSync } from '../../../lib/providers.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { resolveAgentGitInfo } from '../services/git-info.js';
import {
  computeAgentEnrichment,
  type PendingQuestion,
} from '../../../lib/agent-enrichment.js';
import { parseEntireConversation } from '../services/conversation-service.js';
import { parsePiConversationMessages } from '../services/pi-conversation-parser.js';
import { parseOhmypiConversationMessages } from '../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../services/codex-conversation-parser.js';
import { readLauncherPinnedSessionId, resolvePiSessionPath, resolveCodexRolloutPath, resolveAgentHarness } from './jsonl-resolver.js';
import type { ConversationResponse } from '@overdeck/contracts';
import { normalizeAwaitingInputPrompt } from '../../../lib/agent-input-detection.js';
import { buildTmuxCommandString, capturePane, listSessions } from '../../../lib/tmux.js';

import {
  AGENTS_CACHE_TTL_MS,
  agentsCache,
  appendAgentLifecycleLog,
  buildAgentControlEventPayload,
  buildAgentGateFailureSnapshot,
  buildPanStartArgs,
  buildStoppedAgentLifecycle,
  captureAgentOutputBeforeKill,
  constantTimeTokenEqual,
  evaluateAgentStartGate,
  evaluateSpawnGuardrails,
  execAsync,
  execFileAsync,
  filterClosedIssueAgents,
  flyExecCmd,
  getActiveSessionPath,
  getAgentJsonlPath,
  getAgentPendingQuestions,
  getAgentWorkspace,
  getClaudeProjectDir,
  getGitStatusAsync,
  getIssueDataService,
  getPendingQuestions,
  getProjectPath,
  getWorkspaceLocation,
  hasActiveAgentGateOrRetry,
  invalidateAgentsCache,
  readJsonBody,
  readRemoteAgentState,
  spawnPanCommandDetached,
  toAgentStatusPayload,
  validateAgentRuntimeEventAuth,
  type AgentStartGateDecision,
  type SpawnGuardrailDecision,
} from './agents/shared.js';
import {
  getAgentsRoute,
  getAgentGitInfoRoute,
  getAgentTmuxAliveRoute,
  getAgentHasSessionRoute,
  agentHasResolvableWorkspace,
  UNRESOLVABLE_AGENT_GIT_INFO,
} from './agents/listing.js';
import {
  getAgentOutputRoute,
  getAgentConversationRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
  buildConversationResponse,
} from './agents/conversation.js';
import {
  postAgentMessageRoute,
  postAgentTellRoute,
  postAgentPokeRoute,
  validateAgentMessageOrigin,
} from './agents/messaging.js';
import {
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postInternalAgentPermissionRequestRoute,
  postAgentPermissionResponseRoute,
} from './agents/permissions.js';
import {
  getAgentHealthHistoryRoute,
  postAgentHeartbeatRoute,
  postAgentWorkCompleteRoute,
  postAgentStuckRoute,
  postAgentClassifyCompletionRoute,
  getAgentRuntimeRoute,
} from './agents/runtime-events.js';
import {
  deleteAgentRoute,
  postAgentStopRoute,
  postAgentSuspendRoute,
  postAgentPauseRoute,
  postAgentUnpauseRoute,
  postAgentUntroubledRoute,
  createAgentStopHandler,
} from './agents/lifecycle-stop.js';
import {
  postAgentResumeRoute,
  postAgentRecoverRoute,
  postAgentRestartRoute,
  postAgentRestartFreshRoute,
  postAgentsRestartAllRoute,
  postAgentResetSessionRoute,
} from './agents/lifecycle-restart.js';
import {
  getAgentCloisterHealthRoute,
  getAgentHandoffSuggestionRoute,
  postAgentHandoffRoute,
  getAgentCostRoute,
  postAgentDeliveryMethodRoute,
  postAgentSwitchModelRoute,
  validateAgentDeliveryMethodOrigin,
} from './agents/control.js';
import { postAgentsRoute } from './agents/spawn.js';

export {
  buildPanStartArgs,
  spawnPanCommandDetached,
  validateAgentRuntimeEventAuth,
  invalidateAgentsCache,
  evaluateAgentStartGate,
  hasActiveAgentGateOrRetry,
  evaluateSpawnGuardrails,
};

export type {
  SpawnGuardrailDecision,
  AgentStartGateDecision,
};

export {
  agentHasResolvableWorkspace,
  UNRESOLVABLE_AGENT_GIT_INFO,
  buildConversationResponse,
  validateAgentMessageOrigin,
  createAgentStopHandler,
  validateAgentDeliveryMethodOrigin,
};

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const agentsRouteLayer = Layer.mergeAll(
  getAgentsRoute,
  getAgentOutputRoute,
  getAgentConversationRoute,
  postAgentMessageRoute,
  postAgentTellRoute,
  deleteAgentRoute,
  postAgentStopRoute,
  getAgentHealthHistoryRoute,
  postAgentPokeRoute,
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postAgentHeartbeatRoute,
  postAgentWorkCompleteRoute,
  postAgentStuckRoute,
  postAgentClassifyCompletionRoute,
  postInternalAgentPermissionRequestRoute,
  postAgentPermissionResponseRoute,
  getAgentRuntimeRoute,
  getAgentGitInfoRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
  postAgentSuspendRoute,
  postAgentPauseRoute,
  postAgentUnpauseRoute,
  postAgentUntroubledRoute,
  postAgentResumeRoute,
  postAgentRecoverRoute,
  postAgentRestartRoute,
  getAgentCloisterHealthRoute,
  getAgentHandoffSuggestionRoute,
  postAgentHandoffRoute,
  getAgentCostRoute,
  postAgentsRoute,
  postAgentsRestartAllRoute,
  getAgentTmuxAliveRoute,
  getAgentHasSessionRoute,
  postAgentResetSessionRoute,
  postAgentSwitchModelRoute,
  postAgentRestartFreshRoute,
  postAgentDeliveryMethodRoute,
);

export default agentsRouteLayer;
