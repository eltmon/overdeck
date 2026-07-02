import { Effect } from 'effect';
import { getAgentStateSync, type AgentState } from '../agents.js';
import { CostDoorLive, CostWriter } from '../overdeck/cost.js';

type RunningAgent = AgentState & { tmuxActive: boolean };

export async function reconcilePiCostEventsForRunningAgents(runningAgents: readonly RunningAgent[]): Promise<void> {
  if (!runningAgents.some((agent) => getAgentStateSync(agent.id)?.harness === 'ohmypi')) return;

  try {
    await Effect.runPromise(
      CostWriter.use((writer) => writer.reconcile({ source: 'ohmypi' })).pipe(
        Effect.provide(CostDoorLive),
      ),
    );
  } catch (error) {
    console.warn('[cloister] ohmypi cost reconcile failed:', error instanceof Error ? error.message : String(error));
  }
}
