import { Effect } from 'effect';
import { getAgentState, type AgentState } from '../agents.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { CostDoorLive, CostWriter } from '../overdeck/cost.js';

type RunningAgent = AgentState & { tmuxActive: boolean };

async function reconcileSourceForRunningAgents(
  runningAgents: readonly RunningAgent[],
  source: 'ohmypi' | 'codex' | 'prime-agent' | 'grok',
): Promise<void> {
  if (!runningAgents.some((agent) => reconcileSourceFor(getAgentState(agent.id)?.harness) === source)) return;

  try {
    await Effect.runPromise(
      CostWriter.use((writer) => writer.reconcile({ source })).pipe(
        Effect.provide(CostDoorLive),
      ),
    );
  } catch (error) {
    console.warn(`[cloister] ${source} cost reconcile failed:`, error instanceof Error ? error.message : String(error));
  }
}

/** The cost source that reads an agent's transcripts: pi and ohmypi share the 'ohmypi' pi-family source (PAN-5212). */
function reconcileSourceFor(harness: AgentState['harness']): string | undefined {
  return getHarnessBehavior(harness).usesRpcFifo ? 'ohmypi' : harness;
}

export async function reconcilePiCostEventsForRunningAgents(runningAgents: readonly RunningAgent[]): Promise<void> {
  await reconcileSourceForRunningAgents(runningAgents, 'ohmypi');
  await reconcileSourceForRunningAgents(runningAgents, 'codex');
  await reconcileSourceForRunningAgents(runningAgents, 'prime-agent');
  await reconcileSourceForRunningAgents(runningAgents, 'grok');
}
