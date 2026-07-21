/**
 * UAT generation assembly engine (PAN-1737: UAT batch trains).
 *
 * Builds one *generation* — a deterministic-per-day `uat/<label>-<codename>-<MMDD>` branch
 * off current main containing as many ready features as possible, merged in
 * queue order, with cross-feature conflicts resolved on the branch by the
 * injected `resolveConflict` hook (the assembly agent). A feature whose
 * conflict cannot be resolved is *held out* with a human-readable reason and
 * assembly continues — a single bad merge never blocks the batch.
 *
 * Each rebuild for the same label/day force-resets the same branch + persistent
 * worktree under `<projectRoot>/workspaces/`, keeping one authoritative current
 * UAT candidate instead of proliferating stale branches.
 *
 * Pure orchestrator: all git and store I/O is injected (see
 * uat-generation-deps.ts for the real wiring), so every path — happy,
 * conflict-resolved, held-out, failed — is unit-testable with fake deps.
 */
import { makeUatCandidateName } from './uat-candidate-name.js';
import type {
  UatGeneration,
  UatGenerationMember,
  UatGenerationStatus,
} from '../overdeck/merge-sync.js';

/** A feature eligible for bundling, in merge-queue order. */
export interface ReadyFeature {
  issueId: string;
  title: string;
  /** Feature branch, e.g. feature/pan-1704. */
  branch: string;
  pr?: number;
  prUrl?: string;
  /** Issue ids this feature's changed files overlap with (from computeMergeQueue). */
  conflictsWith?: readonly string[];
}

/** Context handed to the conflict-resolution hook while the merge is mid-conflict. */
export interface ConflictContext {
  feature: ReadyFeature;
  /** Members already merged onto the branch, in order. */
  mergedIssueIds: readonly string[];
  /** The already-merged members this feature is known to overlap with. */
  conflictingIssueIds: readonly string[];
  branchName: string;
  worktreePath: string;
}

/** Successful resolution: the hook committed the merge on the branch. */
export interface ConflictResolutionResult {
  files: string[];
  commitSha: string;
}

export interface GenerationGitDeps {
  /** `git fetch origin main` and return the origin/main head SHA. */
  fetchMain(): Promise<string>;
  /** Create or reset the generation worktree branch off origin/main. */
  createWorktree(branchName: string, worktreePath: string): Promise<void>;
  /** Head SHA of a feature branch (origin-first). */
  branchHeadSha(branch: string): Promise<string>;
  /**
   * Merge a feature branch into the generation worktree. On conflict the
   * worktree is left MID-CONFLICT (the hook needs that state); the engine
   * decides whether to resolve or abort.
   */
  mergeBranch(featureBranch: string): Promise<
    { ok: true } | { ok: false; conflict: boolean; reason: string }
  >;
  /** `git merge --abort` in the generation worktree. */
  abortMerge(): Promise<void>;
  /** Push the generation branch to origin. */
  push(branchName: string): Promise<void>;
}

export interface GenerationStorePort {
  /** Insert or reset the generation row at assembly start. */
  insert(gen: Omit<UatGeneration, 'createdAt' | 'updatedAt'>): void;
  update(
    name: string,
    patch: Partial<Pick<UatGeneration, 'status' | 'baseSha' | 'members' | 'heldOut' | 'resolutions' | 'cleanedAt'>>,
  ): void;
  /** Existing generation names. */
  listNames(): string[];
  listChain(projectRoot: string, statuses?: readonly UatGenerationStatus[]): UatGeneration[];
}

export interface AssembleGenerationInput {
  projectRoot: string;
  /** Project label for the codename, e.g. 'pan'. */
  label: string;
  /** ISO date; MMDD goes into the branch name. */
  dateIso: string;
  /** Ready features in merge-queue order. */
  features: readonly ReadyFeature[];
  /** Branch names (beyond the store) already present, e.g. live git refs. */
  takenBranchNames?: readonly string[];
}

export interface AssembleGenerationDeps {
  git: GenerationGitDeps;
  store: GenerationStorePort;
  /**
   * The assembly agent. Called mid-conflict; must either conclude the merge
   * with a commit (returning what it resolved) or return null to give up.
   * Absent hook = every conflict is held out.
   */
  resolveConflict?: (ctx: ConflictContext) => Promise<ConflictResolutionResult | null>;
  log?: (msg: string) => void;
}

/** Branch name → worktree folder name (slashes collapse to dashes). */
export function generationFolderName(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * Assemble the next generation from the given ready set. Always returns the
 * generation row (status 'ready' or 'failed'); throws only on store failures.
 * On success, older 'ready' generations for the project flip to 'superseded'.
 */
export async function assembleUatGeneration(
  input: AssembleGenerationInput,
  deps: AssembleGenerationDeps,
): Promise<UatGeneration> {
  const log = deps.log ?? (() => {});

  const baseSha = await deps.git.fetchMain();
  const name = makeUatCandidateName({
    label: input.label,
    dateIso: input.dateIso,
  });
  const worktreePath = `${input.projectRoot}/workspaces/${generationFolderName(name)}`;

  deps.store.insert({
    name,
    worktreePath,
    projectRoot: input.projectRoot,
    baseSha,
    status: 'assembling',
    members: [],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
  });

  const members: UatGeneration['members'] = [];
  const heldOut: UatGeneration['heldOut'] = [];
  const resolutions: UatGeneration['resolutions'] = [];
  const finish = (status: UatGenerationStatus): UatGeneration => {
    deps.store.update(name, { status, members, heldOut, resolutions });
    return {
      name, worktreePath, projectRoot: input.projectRoot, baseSha,
      status, members, heldOut, resolutions,
      stackStartedAt: null, cleanedAt: null, createdAt: '', updatedAt: '',
    };
  };

  try {
    await deps.git.createWorktree(name, worktreePath);
  } catch (err) {
    log(`[uat-generation] ${name}: worktree creation failed: ${err instanceof Error ? err.message : String(err)}`);
    return finish('failed');
  }

  for (const feature of input.features) {
    const mergedIssueIds = members.map((m) => m.issueId);
    const attemptedHeadSha = async () => deps.git.branchHeadSha(feature.branch).catch(() => 'unknown');
    const recordMember = async (): Promise<UatGenerationMember> => ({
      issueId: feature.issueId,
      title: feature.title,
      branch: feature.branch,
      headSha: await attemptedHeadSha(),
      mergeOrder: members.length + 1,
      ...(feature.pr !== undefined ? { pr: feature.pr } : {}),
      ...(feature.prUrl !== undefined ? { prUrl: feature.prUrl } : {}),
    });
    const holdOut = async (reason: string): Promise<void> => {
      heldOut.push({ issueId: feature.issueId, branch: feature.branch, headSha: await attemptedHeadSha(), reason });
    };

    let result: Awaited<ReturnType<GenerationGitDeps['mergeBranch']>>;
    try {
      result = await deps.git.mergeBranch(feature.branch);
    } catch (err) {
      await deps.git.abortMerge().catch(() => {});
      await holdOut(`merge failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      deps.store.update(name, { members, heldOut, resolutions });
      continue;
    }

    if (result.ok) {
      members.push(await recordMember());
      deps.store.update(name, { members, heldOut, resolutions });
      continue;
    }

    if (!result.conflict || !deps.resolveConflict) {
      await deps.git.abortMerge().catch(() => {});
      await holdOut(result.conflict
        ? `conflicts with ${conflictingWith(feature, mergedIssueIds).join(', ') || 'an earlier member'} — no assembly agent available`
        : result.reason);
      deps.store.update(name, { members, heldOut, resolutions });
      continue;
    }

    const conflictingIssueIds = conflictingWith(feature, mergedIssueIds);
    log(`[uat-generation] ${name}: resolving conflict ${feature.issueId} <-> ${conflictingIssueIds.join(', ') || '(unknown member)'}`);
    let resolution: ConflictResolutionResult | null = null;
    try {
      resolution = await deps.resolveConflict({
        feature,
        mergedIssueIds,
        conflictingIssueIds,
        branchName: name,
        worktreePath,
      });
    } catch (err) {
      log(`[uat-generation] ${name}: conflict agent threw: ${err instanceof Error ? err.message : String(err)}`);
      resolution = null;
    }

    if (resolution) {
      members.push(await recordMember());
      resolutions.push({
        issueIds: [feature.issueId, ...conflictingIssueIds],
        files: resolution.files,
        commitSha: resolution.commitSha,
      });
    } else {
      await deps.git.abortMerge().catch(() => {});
      await holdOut(`conflict with ${conflictingIssueIds.join(', ') || 'an earlier member'} could not be auto-resolved — waits for the next generation`);
    }
    deps.store.update(name, { members, heldOut, resolutions });
  }

  if (members.length === 0) {
    log(`[uat-generation] ${name}: nothing merged (${heldOut.length} held out) — marking failed`);
    return finish('failed');
  }

  try {
    await deps.git.push(name);
  } catch (err) {
    log(`[uat-generation] ${name}: push failed: ${err instanceof Error ? err.message : String(err)}`);
    return finish('failed');
  }

  // This generation is now the current one; older ready generations remain
  // testable but are no longer the freshest — flip them to superseded.
  for (const older of deps.store.listChain(input.projectRoot, ['ready'])) {
    if (older.name !== name) deps.store.update(older.name, { status: 'superseded' });
  }

  log(`[uat-generation] ${name}: ready — ${members.length} member(s), ${resolutions.length} resolution(s), ${heldOut.length} held out`);
  return finish('ready');
}

function conflictingWith(feature: ReadyFeature, mergedIssueIds: readonly string[]): string[] {
  const merged = new Set(mergedIssueIds.map((id) => id.toUpperCase()));
  return (feature.conflictsWith ?? []).filter((id) => merged.has(id.toUpperCase()));
}

export interface GenerationCleanupDeps {
  store: GenerationStorePort;
  /** Remove the generation's worktree directory (idempotent). */
  removeWorktree(worktreePath: string): Promise<void>;
  /** Delete the generation branch locally and on origin (idempotent). */
  deleteBranch(branchName: string): Promise<void>;
  /** Tear down the generation's live stack if one is running. */
  teardownStack?: (generation: UatGeneration) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Reap dead generations' branches/worktrees, and trim the live chain to the
 * newest `keep` (default 3). Trimmed superseded generations flip to
 * 'invalidated' (their branch is gone — no longer testable). Rows are never
 * deleted: the chain is the audit trail. Promoted generations keep their row
 * but lose branch/worktree/stack — their content lives on main now.
 */
export async function cleanupUatGenerations(
  projectRoot: string,
  deps: GenerationCleanupDeps,
  options: { keep?: number } = {},
): Promise<void> {
  const log = deps.log ?? (() => {});
  const keep = options.keep ?? 3;

  const live = deps.store.listChain(projectRoot, ['ready', 'superseded']);
  const trimmed = live.slice(keep);
  const dead = deps.store.listChain(projectRoot, ['invalidated', 'promoted', 'failed'])
    .filter((gen) => !gen.cleanedAt);

  for (const gen of [...trimmed, ...dead]) {
    let cleaned = true;
    if (gen.stackStartedAt && deps.teardownStack) {
      await deps.teardownStack(gen).catch((err) => {
        cleaned = false;
        log(`[uat-generation] cleanup ${gen.name}: stack teardown failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    await deps.removeWorktree(gen.worktreePath).catch((err) => {
      cleaned = false;
      log(`[uat-generation] cleanup ${gen.name}: worktree removal failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    await deps.deleteBranch(gen.name).catch((err) => {
      cleaned = false;
      log(`[uat-generation] cleanup ${gen.name}: branch deletion failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!cleaned) continue;
    const cleanedAt = new Date().toISOString();
    if (gen.status === 'ready' || gen.status === 'superseded') {
      deps.store.update(gen.name, { status: 'invalidated', cleanedAt });
      log(`[uat-generation] cleanup: trimmed ${gen.name} (beyond newest ${keep})`);
    } else {
      deps.store.update(gen.name, { cleanedAt });
    }
  }
}
