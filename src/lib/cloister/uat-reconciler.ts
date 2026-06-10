/**
 * UAT generation reconciler (PAN-1737: UAT batch trains).
 *
 * The loop that keeps "always one batch ready" true with zero human action.
 * Each tick (interval-driven from the dashboard server, or forced via the
 * API's rebuild action):
 *
 *   1. No-op unless the merge train is enabled and a flywheel run is active.
 *   2. Invalidate live generations that went stale — main advanced past their
 *      baseSha, a member left the ready set, or a member branch gained
 *      commits. Invalidation tears down the generation's live stack.
 *      (Older SUBSET generations are NOT stale: a smaller batch off current
 *      main remains perfectly testable and promotable.)
 *   3. If no live generation matches the current desired set, assemble the
 *      next generation in the background. Single-flight per project; a failed
 *      assembly for the SAME desired signature backs off before retrying.
 *   4. Trim/reap the chain (cleanup hook).
 *
 * Pure orchestration with injected deps — interval wiring and real data
 * sources live in the dashboard server service.
 */
import type { ReadyFeature, GenerationStorePort } from './uat-generation-engine.js';
import type { UatGeneration } from '../database/uat-generations-db.js';

/** A crashed 'assembling' row older than this is marked failed (train un-wedge). */
export const STUCK_ASSEMBLING_MS = 30 * 60 * 1000;
/** Minimum age before re-attempting an assembly that failed for the same input. */
export const FAILED_RETRY_BACKOFF_MS = 10 * 60 * 1000;

export interface UatReconcilerDeps {
  /** Gate: flywheel.merge_train_enabled. */
  isEnabled(): boolean;
  /**
   * Current ready set in merge order, or null when it cannot be computed
   * (no active flywheel run) — null means "do nothing", not "empty".
   */
  getReadySet(): Promise<readonly ReadyFeature[] | null>;
  /** Current origin/main head SHA (fetching first). */
  getMainHeadSha(): Promise<string>;
  /** Current head SHA per feature branch (origin-first). */
  getBranchHeadSha(branch: string): Promise<string>;
  store: GenerationStorePort;
  /** Assemble the next generation from the desired set (the engine). */
  assemble(features: readonly ReadyFeature[]): Promise<UatGeneration>;
  /** Tear down a generation's live stack (no-op when none is running). */
  teardownStack(generation: UatGeneration): Promise<void>;
  /** Chain trim/reap (cleanupUatGenerations wiring). */
  cleanup(): Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface ReconcileResult {
  action: 'disabled' | 'no-queue' | 'idle' | 'assembled' | 'assembly-failed' | 'backoff' | 'in-flight';
  invalidated: string[];
  generation?: UatGeneration;
}

/**
 * Single-flight per project: a tick that arrives while one is running gets
 * 'in-flight' immediately instead of queuing (assemblies are minutes-long;
 * the interval would pile up).
 */
const inFlightReconciles = new Map<string, Promise<ReconcileResult>>();

/** Stable signature of "what we want assembled" — backoff bookkeeping. */
function desiredSignature(features: readonly ReadyFeature[], headShas: ReadonlyMap<string, string>, mainSha: string): string {
  const parts = [...features]
    .map((f) => `${f.issueId.toUpperCase()}@${headShas.get(f.branch) ?? 'unknown'}`)
    .sort();
  return `${mainSha}|${parts.join(',')}`;
}

function generationSignature(gen: UatGeneration): string {
  const parts = [
    ...gen.members.map((m) => `${m.issueId.toUpperCase()}@${m.headSha}`),
    ...gen.heldOut.map((h) => `${h.issueId.toUpperCase()}@${h.headSha ?? 'held'}`),
  ].sort();
  return `${gen.baseSha}|${parts.join(',')}`;
}

function liveSignatureMatches(
  gen: UatGeneration,
  features: readonly ReadyFeature[],
  headShas: ReadonlyMap<string, string>,
  mainSha: string,
): boolean {
  if (gen.baseSha !== mainSha) return false;
  const desiredIds = new Set(features.map((f) => f.issueId.toUpperCase()));
  const genIds = new Set([
    ...gen.members.map((m) => m.issueId.toUpperCase()),
    ...gen.heldOut.map((h) => h.issueId.toUpperCase()),
  ]);
  if (desiredIds.size !== genIds.size) return false;
  for (const id of desiredIds) if (!genIds.has(id)) return false;
  for (const member of gen.members) {
    const current = headShas.get(member.branch);
    if (current !== member.headSha) return false;
  }
  for (const held of gen.heldOut) {
    if (!held.branch || !held.headSha) return false;
    const current = headShas.get(held.branch);
    if (current !== held.headSha) return false;
  }
  return true;
}

/** A live generation goes stale when its base moved or a member changed/left. */
function isStale(
  gen: UatGeneration,
  desiredIds: ReadonlySet<string>,
  headShas: ReadonlyMap<string, string>,
  mainSha: string,
): string | null {
  if (gen.baseSha !== mainSha) return `main advanced past base ${gen.baseSha.slice(0, 9)}`;
  for (const member of gen.members) {
    if (!desiredIds.has(member.issueId.toUpperCase())) {
      return `${member.issueId} left the ready queue`;
    }
    const current = headShas.get(member.branch);
    if (current !== member.headSha) {
      return `${member.issueId} branch gained commits`;
    }
  }
  for (const held of gen.heldOut) {
    if (!desiredIds.has(held.issueId.toUpperCase())) {
      return `${held.issueId} left the ready queue`;
    }
    if (!held.branch || !held.headSha) {
      return `${held.issueId} held-out branch metadata missing`;
    }
    const current = headShas.get(held.branch);
    if (current !== held.headSha) {
      return `${held.issueId} branch gained commits`;
    }
  }
  return null;
}

export async function reconcileUatGenerations(
  projectRoot: string,
  deps: UatReconcilerDeps,
  options: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const invalidated: string[] = [];

  if (!deps.isEnabled()) return { action: 'disabled', invalidated };

  if (inFlightReconciles.has(projectRoot)) return { action: 'in-flight', invalidated };

  const tick = async (): Promise<ReconcileResult> => {
    const readySet = await deps.getReadySet();
    if (readySet === null) return { action: 'no-queue', invalidated };

    const mainSha = await deps.getMainHeadSha();
    const headShas = new Map<string, string>();
    for (const f of readySet) {
      headShas.set(f.branch, await deps.getBranchHeadSha(f.branch).catch(() => 'unknown'));
    }
    const desiredIds = new Set(readySet.map((f) => f.issueId.toUpperCase()));

    // 1. Invalidate stale live generations (stack teardown included).
    for (const gen of deps.store.listChain(projectRoot, ['ready', 'superseded'])) {
      const staleReason = isStale(gen, desiredIds, headShas, mainSha);
      if (!staleReason) continue;
      log(`[uat-reconciler] invalidating ${gen.name}: ${staleReason}`);
      deps.store.update(gen.name, { status: 'invalidated' });
      invalidated.push(gen.name);
      await deps.teardownStack(gen).catch((err) => {
        log(`[uat-reconciler] stack teardown for ${gen.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // 2. Un-wedge crashed assemblies; respect a live one.
    const assembling = deps.store.listChain(projectRoot, ['assembling']);
    for (const gen of assembling) {
      const created = Date.parse(gen.createdAt || '');
      // Unparseable createdAt: freshness can't be proven — treat as stuck.
      const age = Number.isFinite(created) ? now() - created : Number.POSITIVE_INFINITY;
      if (age > STUCK_ASSEMBLING_MS) {
        log(`[uat-reconciler] marking stuck assembling generation ${gen.name} failed (age ${Math.round(age / 60000)}m)`);
        deps.store.update(gen.name, { status: 'failed' });
      }
    }
    if (!options.force && deps.store.listChain(projectRoot, ['assembling']).length > 0) {
      return { action: 'in-flight', invalidated };
    }

    if (readySet.length === 0) {
      await deps.cleanup().catch(() => {});
      return { action: 'idle', invalidated };
    }

    // 3. Assemble when nothing live answers the current desired set.
    const desired = desiredSignature(readySet, headShas, mainSha);
    if (!options.force) {
      const live = deps.store.listChain(projectRoot, ['ready', 'superseded']);
      if (live.some((gen) => liveSignatureMatches(gen, readySet, headShas, mainSha))) {
        await deps.cleanup().catch(() => {});
        return { action: 'idle', invalidated };
      }
      const failed = deps.store.listChain(projectRoot, ['failed']);
      const recentFailure = failed.find((gen) =>
        generationSignature(gen) === desired &&
        now() - Date.parse(gen.updatedAt || gen.createdAt || '') < FAILED_RETRY_BACKOFF_MS,
      );
      if (recentFailure) {
        log(`[uat-reconciler] backing off — ${recentFailure.name} failed recently for the same input`);
        return { action: 'backoff', invalidated };
      }
    }

    log(`[uat-reconciler] assembling next generation for ${readySet.length} ready feature(s)`);
    const generation = await deps.assemble(readySet);
    await deps.cleanup().catch(() => {});
    return {
      action: generation.status === 'ready' ? 'assembled' : 'assembly-failed',
      invalidated,
      generation,
    };
  };

  const pending = tick().finally(() => inFlightReconciles.delete(projectRoot));
  inFlightReconciles.set(projectRoot, pending);
  return pending;
}
