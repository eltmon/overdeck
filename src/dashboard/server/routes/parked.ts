/**
 * Parked-population route (PAN-3485 phase 1, re-pointed by PAN-3917 W6).
 *
 * Endpoints:
 *   GET /api/parked — the current parked rows, oldest first (read only)
 *
 * The rows are DERIVED, never stored. W1 removed the record-fed orbits from
 * `src/lib/parked/resolver.ts`; what survives are three orbits, each of which
 * has a real owner:
 *
 *   - `operator-gate`  the tracker label `parked`, or a listing in
 *                      `<planHome>/.pan/parked.md`. Only a human set it, so
 *                      only a human clears it.
 *   - `zombie-session` a live backend pane on an issue that is already closed
 *                      or merged — it holds a session and a slot for nothing.
 *   - `idle-running`   the `stuck` attention: idle past the threshold with
 *                      unpushed commits and no pipeline stage owning the move.
 *
 * The W1 rule about the idle-running orbit is enforced upstream, in
 * `deriveIssueState`: any open PR outranks `parked`, so an issue the pipeline
 * owns (in-review, changes-requested, ready, working) can never appear here as
 * an operator gate.
 *
 * The candidate universe is the in-flight one (live panes ∪ tracker issues), so
 * a per-request resolve is cheap and there is no cache to drift. Rows contain
 * no secrets — this route is a GET and mutates nothing.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import type { DerivedIssueState } from '@overdeck/contracts';

import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { summarizeParked, type ParkedRow } from '../../../lib/parked/resolver.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getBackendPanes } from '../services/backend-inventory.js';
import { loadIssueStatesForProject } from '../services/derived-issue-state.js';

/** Issues the dashboard currently knows about: live panes plus tracker rows. */
function candidateIssueIds(paneIssues: readonly string[]): string[] {
  const ids = new Set(paneIssues);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSharedIssueService } = require('../services/issue-service-singleton.js') as typeof import('../services/issue-service-singleton.js');
    for (const issue of getSharedIssueService().getIssues() as Array<Record<string, unknown>>) {
      const id = typeof issue['identifier'] === 'string' ? issue['identifier'].toUpperCase() : '';
      if (id) ids.add(id);
    }
  } catch {
    // Issue service not started — panes alone still produce zombie/idle rows.
  }
  return [...ids];
}

export interface ResolveParkedDeps {
  now?: () => number;
  panes?: Awaited<ReturnType<typeof getBackendPanes>>;
  loadStates?: typeof loadIssueStatesForProject;
  issueIds?: readonly string[];
}

/** Derive the parked population. Pure over its injected reads. */
export async function resolveDerivedParkedRows(deps: ResolveParkedDeps = {}): Promise<ParkedRow[]> {
  const now = (deps.now ?? Date.now)();
  const panes = deps.panes ?? await getBackendPanes();
  const panesByIssue = new Map<string, typeof panes>();
  for (const pane of panes) {
    if (!pane.issue) continue;
    const list = panesByIssue.get(pane.issue);
    if (list) (list as typeof panes[number][]).push(pane);
    else panesByIssue.set(pane.issue, [pane]);
  }

  const issueIds = deps.issueIds ?? candidateIssueIds([...panesByIssue.keys()]);

  const byProject = new Map<string, string[]>();
  for (const issueId of issueIds) {
    const project = resolveProjectFromIssueSync(issueId);
    if (!project) continue;
    const list = byProject.get(project.projectPath);
    if (list) list.push(issueId); else byProject.set(project.projectPath, [issueId]);
  }

  const derived = new Map<string, DerivedIssueState>();
  const loadStates = deps.loadStates ?? loadIssueStatesForProject;
  for (const [projectPath, ids] of byProject) {
    try {
      for (const [issueId, state] of await loadStates(projectPath, ids)) derived.set(issueId, state);
    } catch {
      // One project's forge or git read failed — the rest still answer.
    }
  }

  const rows: ParkedRow[] = [];
  for (const [issueId, state] of derived) {
    const issuePanes = panesByIssue.get(issueId) ?? [];
    const livePanes = issuePanes.filter((pane) => pane.state !== 'exited' && pane.state !== 'done');

    if (state.state === 'closed' || state.state === 'merged') {
      for (const pane of livePanes) {
        rows.push({
          issueId,
          orbit: 'zombie-session',
          parkedAt: new Date(pane.stateSince ?? now).toISOString(),
          parkReason: `${pane.id} is still running but the issue is ${state.state} — it holds a session and a concurrency slot for nothing`,
          unparkCondition: 'reap the session through the established merged-zombie teardown door',
          details: { agentId: pane.id, role: pane.role, issueState: state.state },
        });
      }
      continue;
    }

    if (state.state === 'parked') {
      rows.push({
        issueId,
        orbit: 'operator-gate',
        parkedAt: new Date(now).toISOString(),
        parkReason: 'the operator parked this issue — a `parked` tracker label, or a listing in .pan/parked.md',
        unparkCondition: 'remove the `parked` label, or drop the issue from .pan/parked.md (operator-only)',
        details: { gate: 'operator-park' },
      });
      continue;
    }

    if (state.attention === 'stuck') {
      const idlePane = livePanes.find((pane) => pane.state === 'idle') ?? livePanes[0];
      const since = idlePane?.stateSince ?? now;
      rows.push({
        issueId,
        orbit: 'idle-running',
        parkedAt: new Date(since).toISOString(),
        parkReason: `${idlePane?.id ?? issueId} is alive but has done nothing for ${Math.floor((now - since) / 60_000)} minutes and has unpushed commits`,
        unparkCondition: 'poke for progress; if none, stop or resume with a nudge through the established agent-control door',
        details: {
          ...(idlePane ? { agentId: idlePane.id } : {}),
          idleMinutes: Math.floor((now - since) / 60_000),
          ...(state.branch ? { aheadOfMain: state.branch.aheadOfMain } : {}),
        },
      });
    }
  }

  rows.sort((a, b) => a.parkedAt.localeCompare(b.parkedAt));
  return rows;
}

const getParkedRoute = HttpRouter.add(
  'GET',
  '/api/parked',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await resolveDerivedParkedRows();
        return jsonResponse({ rows, summary: summarizeParked(rows) });
      },
      catch: (error) => error,
    }).pipe(Effect.catch((error) => Effect.succeed(jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    ))));
  })),
);

export const parkedRouteLayer = Layer.mergeAll(getParkedRoute);

export default parkedRouteLayer;
