/**
 * #4116: the liveness door every runtime's `isRunning` answers through.
 *
 * Runtime modules are reachable from `agents.ts` (e.g. `agents/activity.ts`
 * imports `runtimes/ohmypi.ts`), so a runtime importing `agents/liveness.ts`
 * would close an import cycle. This leaf module imports nothing;
 * `runtimes/index.ts` (which already imports the oracle) registers the
 * backend-aware probe here at module load — the same registration pattern as
 * `registerLivenessHeartbeatLookup`. Every runtime is reached through that
 * registry, so the probe is registered whenever a runtime is in use.
 *
 * The probe answers `true` only when the oracle confirms the agent alive. With
 * no probe registered the answer is `false`: never a claim of liveness the
 * oracle did not make, and never a death either, because the callers that act
 * on a death ask the oracle themselves.
 */

/** Confirmed-alive probe: the agent id plus the runtime's harness name. */
export type RuntimeLivenessProbe = (agentId: string, harness: string) => Promise<boolean>;

let probe: RuntimeLivenessProbe | null = null;

export function registerRuntimeLivenessProbe(next: RuntimeLivenessProbe | null): void {
  probe = next;
}

/** True only when the backend-aware liveness oracle confirms the agent alive. */
export async function isRuntimeAgentAlive(agentId: string, harness: string): Promise<boolean> {
  if (!probe) return false;
  try {
    return await probe(agentId, harness);
  } catch {
    return false;
  }
}
