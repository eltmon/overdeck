/**
 * Type definitions for the merge-sync layer (overdeck.db merge train).
 *
 * Relocated from the legacy src/lib/database/{pending-auto-merges-db,uat-generations-db}.ts
 * SQLite modules (PAN-1983) so those panopticon.db-backed modules can be deleted. These are
 * the canonical shapes; merge-sync.ts re-exports them so existing import paths keep working.
 */
import type { ForgeType } from '../forge.js';

export type PendingAutoMergeStatus = 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';

export interface PendingAutoMerge {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  forge: ForgeType;
  status: PendingAutoMergeStatus;
  /** Absolute ISO timestamp for when the server may attempt the merge; survives process sleep. */
  scheduledMergeAt: string;
  /** Absolute ISO timestamp for when this cooldown entry was scheduled; survives process sleep. */
  scheduledAt: string;
  mergedAt?: string;
  /** Free-text failure/blocker detail, truncated to 1024 characters. */
  failureReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type UatGenerationStatus =
  | 'assembling'
  | 'ready'
  | 'superseded'
  | 'invalidated'
  | 'promoted'
  | 'failed';

/**
 * One member repo a generation actually branched (PAN-3093). A polyrepo project
 * spans N git repos, so each contributing repo carries its own uat branch, base
 * SHA, and worktree; `uat_generations.base_sha` holds only the composite anchor.
 * Monorepo generations write no rows here — readers get a synthesized N=1 entry.
 */
export interface UatGenerationRepo {
  /** Repo key from the project's repo resolver, e.g. 'fe' / 'api'. */
  repoKey: string;
  /** Absolute path to this member repo's git root. */
  repoPath: string;
  /** The uat/<label>-<codename>-<MMDD> branch created in THIS repo. */
  branch: string;
  /** Head SHA of this repo's target branch the uat branch was cut from. */
  baseSha: string;
  /**
   * The branch this repo's uat branch was cut from and must be promoted back
   * into. Persisted rather than re-derived: promote runs long after assembly,
   * and defaulting to `main` would land a repo configured for `develop` on the
   * wrong branch entirely.
   */
  targetBranch: string;
  /** Absolute path to this repo's worktree, <generationFolder>/<repoKey>. */
  worktreePath: string;
  /** Publish order during promote; ascending. */
  mergeOrder: number;
  /** ISO timestamp once this repo's merge landed on its target branch. */
  promotedAt?: string | null;
  /**
   * The merge commit published to this repo's target branch. Recorded with the
   * publish stamp so a promote interrupted after its last push can still be
   * finalized — and so post-merge verification has a real, per-repo git ref.
   */
  mergeSha?: string | null;
}

/** One (member, repo) contribution — the feature branch this issue has in a repo. */
export interface UatGenerationMemberRepo {
  repoKey: string;
  /** Feature branch in THIS repo, e.g. feature/min-901. */
  branch: string;
  /** Head SHA of that feature branch at assembly time — staleness detection. */
  headSha: string;
  /** Position within this repo's merge order. */
  mergeOrderInRepo: number;
}

/** A feature bundled into (or queued for) a generation. */
export interface UatGenerationMember {
  issueId: string;
  title: string;
  /** Feature branch, e.g. feature/pan-1704. */
  branch: string;
  /** Head SHA of the feature branch at assembly time — staleness detection. */
  headSha: string;
  /** 1-based position in the merge order. */
  mergeOrder: number;
  pr?: number;
  prUrl?: string;
  /** Per-repo contributions (polyrepo only); absent for monorepo members. */
  repos?: UatGenerationMemberRepo[];
}

export interface UatGenerationHeldOut {
  issueId: string;
  /** Feature branch attempted when the generation held this issue out. */
  branch?: string;
  /** Head SHA of the attempted feature branch at assembly time. */
  headSha?: string;
  reason: string;
}

/**
 * One assembly-time resolution recorded on a generation branch.
 *
 * Originally conflict-only; PAN-3166 generalized it, so `kind` distinguishes an
 * assembly-agent conflict fix from a union-lint migration renumbering. `kind`
 * is nullable for rows written before it existed — absent reads as `conflict`.
 */
export interface UatGenerationResolution {
  /** The member being merged plus the already-merged members it collided with. */
  issueIds: string[];
  files: string[];
  commitSha: string;
  kind?: 'conflict' | 'migration-renumber';
  /** Human-readable disposition, e.g. `V256__X.sql → V257__X.sql`. */
  note?: string;
}

export interface UatGeneration {
  /** Branch name doubles as the identifier, e.g. uat/calm-otter-0610. */
  name: string;
  /**
   * Monorepo: the generation's single worktree. Polyrepo: the wrapper folder
   * containing one `<repoKey>/` worktree per contributing repo, keeping the
   * stack contract (compose project name, Traefik host) identical either way.
   */
  worktreePath: string;
  projectRoot: string;
  /**
   * Monorepo: SHA of origin/main the branch was assembled off. Polyrepo: the
   * composite anchor `<repoKey>@<shortSha> …` in merge order; the authoritative
   * per-repo SHAs live in `repos[].baseSha`.
   */
  baseSha: string;
  status: UatGenerationStatus;
  /**
   * One entry per repo the generation branched, ascending by mergeOrder.
   *
   * Optional for WRITERS — the monorepo engine constructs generations without
   * it — but every merge-sync read path populates it, so it is always present
   * and non-empty on a generation loaded from the store. A generation with no
   * stored per-repo rows (every monorepo generation, plus rows written before
   * PAN-3093) reads back as a single entry synthesized from
   * `baseSha`/`worktreePath`, so consumers never branch on project type.
   */
  repos?: UatGenerationRepo[];
  members: UatGenerationMember[];
  heldOut: UatGenerationHeldOut[];
  resolutions: UatGenerationResolution[];
  /** ISO timestamp while this generation's live stack is up, else null. */
  stackStartedAt: string | null;
  /** ISO timestamp once branch/worktree/stack artifacts have been cleaned. */
  cleanedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
