import { Effect } from 'effect';
import { getAgentStateSync, type AgentState } from '../agents.js';
import { CostDoorLive, CostWriter } from '../overdeck/cost.js';

type RunningAgent = AgentState & { tmuxActive: boolean };

export async function reconcilePiCostEventsForRunningAgents(runningAgents: readonly RunningAgent[]): Promise<void> {
  const harnesses = new Set(runningAgents.map((agent) => getAgentStateSync(agent.id)?.harness));
  const sources: Array<'ohmypi' | 'codex'> = [];
  if (harnesses.has('ohmypi')) sources.push('ohmypi');
  if (harnesses.has('codex')) sources.push('codex');
  if (sources.length === 0) return;

  for (const source of sources) {
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
}
