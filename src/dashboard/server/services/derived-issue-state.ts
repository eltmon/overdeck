/**
 * Derived issue state, server side (PAN-3917 FR-6, W6).
 *
 * The derivation itself lives in `src/lib/overdeck/derived-issue-state.ts` —
 * one implementation for the CLI and the dashboard alike. This file is the
 * server's adapter: it hands that loader the facts the server already holds,
 * so a board render does not re-read what the caches answer.
 *
 *   - the tracker row comes from the shared `IssueDataService` cache, so a
 *     closed issue keeps the top of the precedence without a network read;
 *   - pane liveness comes from `backend-inventory`, the process-wide inventory
 *     the read model already folds events into.
 *
 * An issue no tracker has answered for is reported `trackerUnknown`, never as
 * an open issue.
 *
 * Board reads through `loadIssueStatesForProject` take the repo's PR listing
 * stale-while-revalidate (`listRepoPullRequestsStaleOk`, PAN-3925): a listing
 * past its 30s TTL still answers while one refresh runs, so a request waits
 * on `gh pr list` only when no listing younger than two minutes exists.
 * `loadIssueStatesForIssues` groups ids by project and batches each project
 * in parallel — the door for routes that hold ids from many projects.
 */

import type { DerivedIssueState } from '@overdeck/contracts';

import {
  getDerivedIssueState as libGetDerivedIssueState,
  listRepoPullRequestsStaleOk,
  loadIssueStatesForProject as libLoadIssueStatesForProject,
  type IssueStateLoaderDeps,
  type TrackerIssueFacts,
} from '../../../lib/overdeck/derived-issue-state.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getBackendPanes } from './backend-inventory.js';
import { getSharedIssueService } from './issue-service-singleton.js';

export {
  DEFAULT_STUCK_AFTER_MS,
  PR_CACHE_TTL_MS,
  deriveIssueState,
  forgeForProject,
  issueIdFromBranch,
  listReadyIssuesForProject,
  listRepoPullRequests,
  listRepoPullRequestsStaleOk,
  loadIssueStateFacts,
  mrFromGlabRow,
  paneFromBackendSnapshot,
  parkedListedIn,
  prFromGhRow,
  readIssueFromTracker,
  specExistsFor,
  toChecksState,
  toChecksStateFromPipeline,
  toReviewState,
  type IssueStateFacts,
  type IssueStateLoaderDeps,
  type LoadedPr,
  type ReadyIssue,
  type TrackerIssueFacts,
} from '../../../lib/overdeck/derived-issue-state.js';

/** The cached tracker row for one issue, or null when no tracker has it. */
function cachedTrackerIssue(issueId: string): TrackerIssueFacts | null {
  try {
    return getSharedIssueService().getTrackerIssue(issueId);
  } catch {
    return null;
  }
}

/** Deps every server call shares: cached panes, and the cached tracker row. */
async function withServerFacts(
  issueId: string,
  deps: IssueStateLoaderDeps,
): Promise<IssueStateLoaderDeps> {
  const panes = deps.panes
    ?? (await getBackendPanes()).filter((pane) => pane.issue === issueId.toUpperCase());
  if (deps.issue || deps.readIssue) return { ...deps, panes };
  const issue = cachedTrackerIssue(issueId);
  return issue ? { ...deps, panes, issue } : { ...deps, panes, readIssue: async () => null };
}

/** Load and derive one issue. The read door every route uses. */
export async function getDerivedIssueState(
  issueId: string,
  deps: IssueStateLoaderDeps = {},
): Promise<DerivedIssueState> {
  return libGetDerivedIssueState(issueId, await withServerFacts(issueId, deps));
}

type BatchDeps = NonNullable<Parameters<typeof libLoadIssueStatesForProject>[2]>;

/**
 * Derive many issues at once — one forge listing per repo, one inventory read.
 * Callers that already hold the tracker rows pass them in `issues`; the rest
 * get them from the shared issue cache here.
 */
export async function loadIssueStatesForProject(
  projectPath: string,
  issueIds: readonly string[],
  deps: BatchDeps = {},
): Promise<Map<string, DerivedIssueState>> {
  const panes = deps.panes ?? await getBackendPanes();
  const issues = deps.issues ?? Object.fromEntries(
    issueIds.map((raw) => {
      const issueId = raw.toUpperCase();
      return [issueId, cachedTrackerIssue(issueId)];
    }),
  );
  const listPullRequests = deps.listPullRequests ?? listRepoPullRequestsStaleOk;
  return libLoadIssueStatesForProject(projectPath, issueIds, { ...deps, panes, issues, listPullRequests });
}

/**
 * Derive issues from any number of projects: ids grouped by project, one
 * batch per project, the projects in parallel, one inventory read shared by
 * all of them. An id with no registered project is absent from the result, and
 * a project whose batch fails drops only its own ids.
 */
export async function loadIssueStatesForIssues(
  issueIds: Iterable<string>,
  deps: BatchDeps & {
    readonly resolveProject?: (issueId: string) => { readonly projectPath: string } | null;
  } = {},
): Promise<Map<string, DerivedIssueState>> {
  const resolveProject = deps.resolveProject ?? resolveProjectFromIssueSync;
  const byProject = new Map<string, string[]>();
  for (const issueId of new Set([...issueIds].map((id) => id.toUpperCase()))) {
    const project = resolveProject(issueId);
    if (!project) continue;
    const ids = byProject.get(project.projectPath);
    if (ids) ids.push(issueId); else byProject.set(project.projectPath, [issueId]);
  }
  const out = new Map<string, DerivedIssueState>();
  if (byProject.size === 0) return out;
  const panes = deps.panes ?? await getBackendPanes();
  const batches = await Promise.all([...byProject].map(([projectPath, ids]) =>
    loadIssueStatesForProject(projectPath, ids, { ...deps, panes }).catch(() => new Map<string, DerivedIssueState>())));
  for (const batch of batches) for (const [issueId, state] of batch) out.set(issueId, state);
  return out;
}
