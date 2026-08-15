import { emitActivityEntrySync } from '../activity-logger.js';
import { listSlotAssignments, type SlotReconcileResult } from '../agents/slot-reconcile.js';
import { readSwarmHold, writeSwarmHold } from './deacon-swarm-record.js';
import { workResumeSlotsAvailable } from './concurrency.js';
import { ensureSwarmForeman } from './swarm-foreman.js';

export interface SwarmForemanLivenessDeps {
  listSlotAssignments: (issueId: string, workspacePath: string) => Array<{ slotIndex: number }>;
  readSwarmHold: typeof readSwarmHold;
  workResumeSlotsAvailable: typeof workResumeSlotsAvailable;
  ensureSwarmForeman: typeof ensureSwarmForeman;
  writeSwarmHold: typeof writeSwarmHold;
  emitActivityEntry: typeof emitActivityEntrySync;
}

const defaultDeps: SwarmForemanLivenessDeps = {
  listSlotAssignments,
  readSwarmHold,
  workResumeSlotsAvailable,
  ensureSwarmForeman,
  writeSwarmHold,
  emitActivityEntry: emitActivityEntrySync,
};

const respawnFailures = new Map<string, number>();

export async function maintainSwarmForeman(
  issueId: string,
  workspacePath: string,
  reconciled: SlotReconcileResult,
  sessions: readonly string[],
  overrides: Partial<SwarmForemanLivenessDeps> = {},
  allowSpawn = true,
  bootstrap = false,
): Promise<string[]> {
  const definedOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  const deps = { ...defaultDeps, ...definedOverrides } as SwarmForemanLivenessDeps;
  const issueLower = issueId.toLowerCase();
  if (!allowSpawn) return [];
  const mergedSlotIndexes = new Set(reconciled.merged.map(slot => slot.slotIndex));
  const active = bootstrap || sessions.some(name => name.startsWith(`agent-${issueLower}-slot-`))
    || reconciled.branches.some(branch => !mergedSlotIndexes.has(branch.slotIndex))
    || deps.listSlotAssignments(issueId, workspacePath).length > 0;
  if (!active) {
    respawnFailures.delete(issueId);
    return [];
  }
  if (sessions.includes(`agent-${issueLower}`) || deps.readSwarmHold(workspacePath, issueId)) return [];
  if (deps.workResumeSlotsAvailable() <= 0) {
    return [`[swarm-janitor] deferred foreman respawn for ${issueId}: resource governor`];
  }

  const failures = respawnFailures.get(issueId) ?? 0;
  if (failures >= 3) return [];
  try {
    const prompt = `Resume ${issueId} swarm foreman duties: read .pan/continue.json, run pan swarm status ${issueId} --json, reconcile current state, then continue the wave loop.`;
    const actions = await deps.ensureSwarmForeman(issueId, workspacePath, { startedBy: 'deacon:swarm-janitor', prompt });
    respawnFailures.delete(issueId);
    return actions;
  } catch (error) {
    const count = failures + 1;
    respawnFailures.set(issueId, count);
    const actions = [`[swarm-janitor] foreman respawn failed for ${issueId} (${count}/3): ${error instanceof Error ? error.message : String(error)}`];
    if (count < 3) return actions;

    const message = `${issueId} swarm halted after 3 consecutive foreman respawn failures; operator action is required.`;
    await deps.writeSwarmHold(workspacePath, issueId, { reason: message, setBy: 'deacon:swarm-janitor', at: new Date().toISOString() });
    deps.emitActivityEntry({ source: 'cloister', level: 'error', issueId, message });
    actions.push(`[swarm-janitor] ${message}`);
    return actions;
  }
}

export function resetForemanRespawnFailuresForTests(): void {
  respawnFailures.clear();
}
