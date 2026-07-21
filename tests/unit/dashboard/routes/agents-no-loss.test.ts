import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');
const AGENTS_ROUTE_FILE = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'agents.ts');

const EXPECTED_AGENT_ROUTE_LAYERS = [
  'getAgentsRoute',
  'getAgentOutputRoute',
  'getAgentConversationRoute',
  'postAgentMessageRoute',
  'postAgentTellRoute',
  'deleteAgentRoute',
  'postAgentStopRoute',
  'getAgentHealthHistoryRoute',
  'postAgentPokeRoute',
  'getAgentPendingQuestionsRoute',
  'postAgentAnswerQuestionRoute',
  'postAgentPlanActionRoute',
  'postAgentHeartbeatRoute',
  'postAgentWorkCompleteRoute',
  'postAgentStuckRoute',
  'postAgentClassifyCompletionRoute',
  'postInternalAgentPermissionRequestRoute',
  'postAgentPermissionResponseRoute',
  'getAgentRuntimeRoute',
  'getAgentGitInfoRoute',
  'getAgentActivityRoute',
  'getAgentFilesRoute',
  'getAgentTimelineRoute',
  'postAgentSuspendRoute',
  'postAgentPauseRoute',
  'postAgentUnpauseRoute',
  'postAgentUntroubledRoute',
  'postAgentResumeRoute',
  'postAgentRecoverRoute',
  'postAgentRestartRoute',
  'getAgentCloisterHealthRoute',
  'getAgentHandoffSuggestionRoute',
  'postAgentHandoffRoute',
  'getAgentCostRoute',
  'postAgentsRoute',
  'postAgentsRestartAllRoute',
  'getAgentTmuxAliveRoute',
  'getAgentHasSessionRoute',
  'postAgentResetSessionRoute',
  'postAgentSwitchModelRoute',
  'postAgentRestartFreshRoute',
  'postAgentDeliveryMethodRoute',
  'getAgentsRestartConfigRoute',
  'postAgentsRestartWithConfigRoute',
] as const;

const EXPECTED_PUBLIC_EXPORTS = [
  'agentsRouteLayer',
  'default agentsRouteLayer',
  'buildPanStartArgs',
  'spawnPanCommandDetached',
  'validateAgentRuntimeEventAuth',
  'invalidateAgentsCache',
  'SpawnGuardrailDecision',
  'AgentStartGateDecision',
  'evaluateAgentStartGate',
  'hasActiveAgentGateOrRetry',
  'evaluateSpawnGuardrails',
  'buildConversationResponse',
  'validateAgentMessageOrigin',
  'createAgentStopHandler',
  'agentHasResolvableWorkspace',
  'UNRESOLVABLE_AGENT_GIT_INFO',
  'validateAgentDeliveryMethodOrigin',
] as const;

function readAgentsRoute(): string {
  return readFileSync(AGENTS_ROUTE_FILE, 'utf8');
}

function enumerateMergeAllLayers(source: string): string[] {
  const match = source.match(/Layer\.mergeAll\(([\s\S]*?)\n\);/);
  if (!match) return [];

  return match[1]
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean);
}

describe('PAN-2147 agents route barrel no-loss audit', () => {
  it('keeps the same 43 agentsRouteLayer entries in the same order', () => {
    const liveLayers = enumerateMergeAllLayers(readAgentsRoute());

    expect(liveLayers).toEqual(EXPECTED_AGENT_ROUTE_LAYERS);
    expect(liveLayers).toHaveLength(44);
  });

  it('keeps routes/agents.ts as a thin barrel with no handler bodies', () => {
    const source = readAgentsRoute();

    expect(source).not.toContain('HttpRouter.add(');
    expect(source).not.toContain('httpHandler(');
    expect(source).not.toContain('Effect.gen(function*');
    expect(source).not.toContain('readJsonBody');

    const nonBarrelImports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"];$/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier !== 'effect' && !specifier.startsWith('./agents/'));

    expect(nonBarrelImports).toEqual([]);
  });

  it('keeps the legacy routes/agents.js public export names', () => {
    const source = readAgentsRoute();

    for (const exportName of EXPECTED_PUBLIC_EXPORTS) {
      expect(source, `Missing legacy export ${exportName}`).toContain(exportName);
    }
  });
});
