/**
 * Standing tier agents for tiered execution (PAN-1791, FR-6 scheduling half).
 *
 * A standing tier agent is a long-lived registered slot — spawned through
 * spawnRun(issueId, 'work', { slotIndex, slotItemId }) exactly like any other
 * registered slot agent (state file + tmux session + dashboard discovery
 * under the issue) — that persists across the many beads of its tier instead
 * of living per-bead. No new agent kind is introduced.
 *
 * The schedule is the plan-time tier-run sequence (PRD §5.6): waves are
 * linearized via groupItemsByWave, each item is annotated with its tier via
 * resolveTier, and consecutive same-tier items are cut into runs at
 * tier-change boundaries. Standing sessions are instantiated lazily — a
 * tier's session spawns when its first run is <=1 run away, not all at
 * start — so a cancelled run never strands sessions it would not have used.
 */

import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';
import { groupItemsByWave } from '../vbrief/dag.js';
import { resolveTier, type ResolveTierConfig } from './resolve-tier.js';
import type { AgentState } from './agent-state.js';
import type { SpawnRunOptions } from './spawn-prep.js';
import { spawnRun } from './spawn.js';

/** One tier run: consecutive beads in DAG order that route to the same tier. */
export interface TierRun {
  tierName: string;
  beadIds: string[];
}

export class StandingTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StandingTierError';
  }
}

/**
 * Compute the ordered tier-run schedule from a plan and the tier table.
 * Waves are linearized in order (items within a wave in array order), each
 * item resolves to its tier, and a new run starts whenever the tier changes.
 *
 * Unroutable items (no difficulty, unknown tier) propagate resolveTier's
 * named error — scheduling failures are finalize-time errors in the same
 * family as the quality-lint checks, never silent fallbacks.
 */
export function computeTierRunSchedule(
  doc: VBriefDocument,
  config: ResolveTierConfig,
): TierRun[] {
  const itemById = new Map(doc.plan.items.map((item) => [item.id, item]));
  const runs: TierRun[] = [];
  for (const wave of groupItemsByWave(doc)) {
    for (const waveItem of wave.items) {
      const item = itemById.get(waveItem.id);
      if (!item) continue;
      const tier = resolveTier(item, config);
      const currentRun = runs[runs.length - 1];
      if (currentRun && currentRun.tierName === tier.tierName) {
        currentRun.beadIds.push(item.id);
      } else {
        runs.push({ tierName: tier.tierName, beadIds: [item.id] });
      }
    }
  }
  return runs;
}

/** The exact set of tier names a schedule contains, in first-appearance order. */
export function tiersNeededForSchedule(schedule: TierRun[]): string[] {
  const seen = new Set<string>();
  for (const run of schedule) seen.add(run.tierName);
  return Array.from(seen);
}

/** A spawned standing tier agent tracked in the registry. */
export interface StandingTierAgent {
  tierName: string;
  slotIndex: number;
  agentId: string;
  /** The tier's first scheduled bead — the slotItemId its session was spawned for. */
  firstItemId: string;
}

/**
 * Spawn seam matching spawnRun's registered-slot signature. Injectable so the
 * manager is unit-testable; defaults to spawnRun.
 */
export type StandingTierSpawn = (
  issueId: string,
  role: 'work',
  options: SpawnRunOptions,
) => Promise<AgentState>;

export interface StandingTierManagerOptions {
  issueId: string;
  schedule: TierRun[];
  /** Injectable for tests. Defaults to spawnRun's registered-slot path. */
  spawn?: StandingTierSpawn;
  /**
   * Slot index allocated to the first standing tier; subsequent tiers take
   * the following indexes. Defaults to 1.
   */
  firstSlotIndex?: number;
  /** Extra prompt appended to each standing slot's kickoff (foreman protocol). */
  prompt?: string;
}

/**
 * Manages the set of standing tier agents for one issue: which tiers the
 * schedule needs, lazy spawn, a registry keyed by tier name, and bead
 * routing to the standing slot.
 */
/** The bead currently being implemented by a standing tier agent. */
export interface InFlightBead {
  beadId: string;
  tierName: string;
  agentId: string;
}

export class StandingTierManager {
  private readonly registry = new Map<string, StandingTierAgent>();
  private nextSlotIndex: number;
  private inFlight: InFlightBead | undefined;

  constructor(private readonly options: StandingTierManagerOptions) {
    this.nextSlotIndex = options.firstSlotIndex ?? 1;
  }

  /** Exactly the tier names the schedule contains — no tier outside it ever spawns. */
  tiersNeeded(): string[] {
    return tiersNeededForSchedule(this.options.schedule);
  }

  /** The standing agent for a tier, if its session has been spawned. */
  getStandingAgent(tierName: string): StandingTierAgent | undefined {
    return this.registry.get(tierName);
  }

  /** 0-based index of the first run belonging to a tier, or -1 when absent. */
  firstRunIndexFor(tierName: string): number {
    return this.options.schedule.findIndex((run) => run.tierName === tierName);
  }

  /**
   * Lazy instantiation (PRD §5.6): ensure a standing session exists for every
   * scheduled tier whose first run is <=1 run away from currentRunIndex.
   * Already-spawned tiers are reused, never respawned. Returns the agents
   * spawned by this call.
   */
  async ensureStandingTiersForRun(currentRunIndex: number): Promise<StandingTierAgent[]> {
    const spawned: StandingTierAgent[] = [];
    for (const tierName of this.tiersNeeded()) {
      if (this.registry.has(tierName)) continue;
      const firstRun = this.firstRunIndexFor(tierName);
      if (firstRun <= currentRunIndex + 1) {
        spawned.push(await this.spawnStandingTier(tierName));
      }
    }
    return spawned;
  }

  /**
   * Ensure the registered slot for a tier exists, spawning the standing
   * session lazily if it does not exist yet, and return that slot's agent id.
   * Throws for a tier the schedule does not contain — the manager never
   * spawns outside the schedule.
   */
  async ensureStandingAgentForTier(tierName: string, bead: Pick<VBriefItem, 'id'>): Promise<string> {
    if (this.firstRunIndexFor(tierName) === -1) {
      throw new StandingTierError(
        `tier '${tierName}' is not in the schedule for ${this.options.issueId}; refusing to route bead '${bead.id}'`,
      );
    }
    const agent = this.registry.get(tierName) ?? await this.spawnStandingTier(tierName);
    return agent.agentId;
  }

  /** The bead currently in flight, if any. */
  getInFlightBead(): InFlightBead | undefined {
    return this.inFlight;
  }

  /**
   * Foreman dispatch step enforcing the single-implementer invariant: only
   * one implementation agent works a bead at a time — standing tiers share
   * the foreman's worktree, so two in-flight beads would race the same tree.
   * Throws while another bead is in flight; call completeBead after the
   * foreman has staged, committed, and broadcast the result.
   */
  async dispatchBeadToTier(tierName: string, bead: Pick<VBriefItem, 'id'>): Promise<string> {
    if (this.inFlight) {
      throw new StandingTierError(
        `bead '${this.inFlight.beadId}' is still in flight on tier '${this.inFlight.tierName}' for ${this.options.issueId}; `
        + `only one implementation agent works a bead at a time — complete it before dispatching '${bead.id}'`,
      );
    }
    const agentId = await this.ensureStandingAgentForTier(tierName, bead);
    this.inFlight = { beadId: bead.id, tierName, agentId };
    return agentId;
  }

  /** Backward-compatible name for callers that already spell the invariant explicitly. */
  async dispatchBeadExclusive(tierName: string, bead: Pick<VBriefItem, 'id'>): Promise<string> {
    return this.dispatchBeadToTier(tierName, bead);
  }

  /** Mark the in-flight bead complete (committed + broadcast), freeing dispatch. */
  completeBead(beadId: string): void {
    if (!this.inFlight || this.inFlight.beadId !== beadId) {
      throw new StandingTierError(
        `bead '${beadId}' is not the in-flight bead for ${this.options.issueId}`
        + `${this.inFlight ? ` ('${this.inFlight.beadId}' is)` : ' (nothing is in flight)'}`,
      );
    }
    this.inFlight = undefined;
  }

  private async spawnStandingTier(tierName: string): Promise<StandingTierAgent> {
    const firstRun = this.options.schedule.find((run) => run.tierName === tierName);
    const firstItemId = firstRun?.beadIds[0];
    if (!firstItemId) {
      throw new StandingTierError(
        `tier '${tierName}' has no scheduled beads for ${this.options.issueId}; nothing to spawn a standing session for`,
      );
    }
    const slotIndex = this.nextSlotIndex++;
    const spawn = this.options.spawn ?? spawnRun;
    const state = await spawn(this.options.issueId, 'work', {
      slotIndex,
      slotItemId: firstItemId,
      prompt: this.options.prompt,
    });
    const agent: StandingTierAgent = {
      tierName,
      slotIndex,
      agentId: state.id,
      firstItemId,
    };
    this.registry.set(tierName, agent);
    return agent;
  }
}
