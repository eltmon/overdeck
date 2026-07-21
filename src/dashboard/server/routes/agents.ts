/**
 * Agents route barrel — Effect HttpRouter.Layer (PAN-428 B7)
 *
 * Composes all /api/agents/* route layers and preserves the public helper
 * exports that external callers historically imported from routes/agents.js.
 */

import { Layer } from 'effect';

import {
  getAgentsRoute,
  getAgentGitInfoRoute,
  getAgentTmuxAliveRoute,
  getAgentHasSessionRoute,
} from './agents/listing.js';
import {
  getAgentOutputRoute,
  getAgentConversationRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
} from './agents/conversation.js';
import {
  postAgentMessageRoute,
  postAgentTellRoute,
  postAgentPokeRoute,
} from './agents/messaging.js';
import {
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postAgentPlanActionRoute,
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
} from './agents/lifecycle-stop.js';
import {
  postAgentResumeRoute,
  postAgentRecoverRoute,
  postAgentRestartRoute,
  postAgentRestartFreshRoute,
  postAgentsRestartAllRoute,
  postAgentResetSessionRoute,
  getAgentsRestartConfigRoute,
  postAgentsRestartWithConfigRoute,
} from './agents/lifecycle-restart.js';
import {
  getAgentCloisterHealthRoute,
  getAgentHandoffSuggestionRoute,
  postAgentHandoffRoute,
  getAgentCostRoute,
  postAgentDeliveryMethodRoute,
  postAgentSwitchModelRoute,
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
} from './agents/shared.js';

export type {
  SpawnGuardrailDecision,
  AgentStartGateDecision,
} from './agents/shared.js';

export {
  agentHasResolvableWorkspace,
  UNRESOLVABLE_AGENT_GIT_INFO,
} from './agents/listing.js';
export { buildConversationResponse } from './agents/conversation.js';
export { validateAgentMessageOrigin } from './agents/messaging.js';
export { createAgentStopHandler } from './agents/lifecycle-stop.js';
export { validateAgentDeliveryMethodOrigin } from './agents/control.js';

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
  postAgentPlanActionRoute,
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
  getAgentsRestartConfigRoute,
  postAgentsRestartWithConfigRoute,
);

export default agentsRouteLayer;
