import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { parseSequenceMd, writeSequenceMd } from '../../../lib/backlog/sequence-io.js';
import { applyIssueParkedLabel } from '../../../lib/backlog/label-ops.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { getBacklogSequenceForRoot } from '../../../lib/overdeck/backlog.js';
import { spawnSequencerAgent } from '../../../lib/backlog/sequencer-agent.js';
import type { PassMode } from '../../../lib/backlog/types.js';
import type { Issue } from '../../../lib/tracker/interface.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
});

// ─── Route: GET /api/backlog/sequence ────────────────────────────────────────

const getBacklogSequenceRoute = HttpRouter.add(
  'GET',
  '/api/backlog/sequence',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const projectRoot = process.cwd();

        // Read nodes from cache (primary path), seeding it from sequence.md if needed.
        // Falls back to stale cache rows when sequence.md is absent/unparseable.
        const { nodes: cachedNodes, edges } = getBacklogSequenceForRoot(projectRoot);

        if (cachedNodes.length === 0) {
          return jsonResponse({ nodes: [], edges: [] });
        }

        // Enrich cached rows with live per-issue status (not stored in the cache).
        // Mirrors the join logic in src/lib/backlog/backlog-input.ts for consistency.
        const draftsDir = join(projectRoot, '.pan', 'drafts');
        const prdFiles = existsSync(draftsDir)
          ? new Set(readdirSync(draftsDir).map((f) => f.replace(/\.md$/, '').toUpperCase()))
          : new Set<string>();

        const specsDir = join(projectRoot, '.pan', 'specs');
        const specIssues = new Set<string>();
        if (existsSync(specsDir)) {
          for (const f of readdirSync(specsDir)) {
            const match = /^[\d-]+-([A-Z]+-\d+)-/i.exec(f);
            if (match) specIssues.add(match[1]!.toUpperCase());
          }
        }

        const workspacesDir = join(projectRoot, 'workspaces');
        const issuesWithBeads = new Set<string>();
        if (existsSync(workspacesDir)) {
          for (const dir of readdirSync(workspacesDir)) {
            const match = /^feature-([a-z]+-\d+)$/i.exec(dir);
            if (match) {
              if (existsSync(join(workspacesDir, dir, '.beads', 'issues.jsonl'))) {
                issuesWithBeads.add(match[1]!.toUpperCase());
              }
            }
          }
        }

        const nodes = cachedNodes.map((r) => {
          const issueUpper = r.issueId.toUpperCase();
          const reviewStatus = getReviewStatusSync(issueUpper);
          const inPipeline =
            (reviewStatus !== null && reviewStatus.reviewStatus !== 'pending') ||
            existsSync(join(workspacesDir, `feature-${r.issueId.toLowerCase()}`));
          const hasPrd = prdFiles.has(issueUpper);
          const ready = specIssues.has(issueUpper) && issuesWithBeads.has(issueUpper);
          return {
            issueId: r.issueId,
            rank: r.rank,
            size: r.size,
            importance: r.importance,
            score: r.score,
            condition: r.condition,
            dependsOn: r.dependsOn,
            why: r.why,
            gate: r.gate,
            planning: r.planning,
            inPipeline,
            hasPrd,
            ready,
          };
        });

        return jsonResponse({ nodes, edges });
      },
      catch: (err) => new Error(String(err)),
    });
  })),
);

// ─── Route: POST /api/backlog/sequence/regenerate ─────────────────────────────

const postBacklogRegenerateRoute = HttpRouter.add(
  'POST',
  '/api/backlog/sequence/regenerate',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const projectRoot = process.cwd();
    const passRaw = body['pass'];
    const validPasses = new Set(['creation', 'incremental', 'review']);
    const pass: PassMode | 'auto' =
      typeof passRaw === 'string' && validPasses.has(passRaw)
        ? (passRaw as PassMode)
        : 'auto';

    return yield* Effect.promise(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSharedIssueService } = require('../services/issue-service-singleton.js') as
        typeof import('../services/issue-service-singleton.js');
      const issues = getSharedIssueService().getIssues() as Issue[];
      const agent = await spawnSequencerAgent(pass, { projectRoot, issues });
      return jsonResponse({ status: 'spawned', agentId: agent.id, pass });
    });
  })),
);

// ─── Route: POST /api/backlog/sequence/gate ───────────────────────────────────

const postBacklogGateRoute = HttpRouter.add(
  'POST',
  '/api/backlog/sequence/gate',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const issueId = String(body['issueId'] ?? '');
    const gate = String(body['gate'] ?? '');

    if (!issueId) return yield* Effect.fail(new Error('issueId is required') as never);
    if (!['auto', 'ready', 'blocked'].includes(gate))
      return yield* Effect.fail(new Error('gate must be auto, ready, or blocked') as never);

    return yield* Effect.promise(async () => {
      const projectRoot = process.cwd();
      const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
      if (!existsSync(seqPath)) throw new Error('sequence.md not found');

      const md = readFileSync(seqPath, 'utf-8');
      const parsed = parseSequenceMd(md);
      if (!parsed.ok) throw new Error(`parse error: ${parsed.error}`);

      const doc = parsed.doc;
      const node = doc.nodes.find((n) => n.issue.toUpperCase() === issueId.toUpperCase());
      if (!node) throw new Error(`issue ${issueId} not found in sequence`);

      node.gate = gate as 'auto' | 'ready' | 'blocked';
      writeSequenceMd(projectRoot, doc, { operatorEdit: true });

      if (gate === 'blocked') {
        await applyIssueParkedLabel(issueId);
      }

      return jsonResponse({ status: 'ok', issueId, gate });
    });
  })),
);

// ─── Route: POST /api/backlog/sequence/planning ───────────────────────────────

const postBacklogPlanningRoute = HttpRouter.add(
  'POST',
  '/api/backlog/sequence/planning',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const issueId = String(body['issueId'] ?? '');
    const planning = String(body['planning'] ?? '');

    if (!issueId) return yield* Effect.fail(new Error('issueId is required') as never);
    if (!['skip', 'auto', 'interactive'].includes(planning))
      return yield* Effect.fail(new Error('planning must be skip, auto, or interactive') as never);

    return yield* Effect.promise(async () => {
      const projectRoot = process.cwd();
      const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
      if (!existsSync(seqPath)) throw new Error('sequence.md not found');

      const md = readFileSync(seqPath, 'utf-8');
      const parsed = parseSequenceMd(md);
      if (!parsed.ok) throw new Error(`parse error: ${parsed.error}`);

      const doc = parsed.doc;
      const node = doc.nodes.find((n) => n.issue.toUpperCase() === issueId.toUpperCase());
      if (!node) throw new Error(`issue ${issueId} not found in sequence`);

      node.planning = planning as 'skip' | 'auto' | 'interactive';
      writeSequenceMd(projectRoot, doc, { operatorEdit: true });

      return jsonResponse({ status: 'ok', issueId, planning });
    });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const backlogRouteLayer = Layer.mergeAll(
  getBacklogSequenceRoute,
  postBacklogRegenerateRoute,
  postBacklogGateRoute,
  postBacklogPlanningRoute,
);

export default backlogRouteLayer;
