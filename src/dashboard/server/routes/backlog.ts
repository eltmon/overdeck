import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { parseSequenceMd, writeSequenceMd } from '../../../lib/backlog/sequence-io.js';
import {
  applyIssueVetoedLabel, removeIssueVetoedLabel,
  applyIssueReadyLabel, removeIssueReadyLabel,
  applyIssueParkedLabel, removeIssueParkedLabel,
  applyIssueBlocksMainLabel, removeIssueBlocksMainLabel,
  applyIssueReleasedLabel, removeIssueReleasedLabel,
  applyIssueObjectionLabel, removeIssueObjectionLabel,
} from '../../../lib/backlog/label-ops.js';
import {
  normalizeGate, classifyIssue, computeWaves, computeLanes, computeCohort, computeStats, computeEpicGroups,
  selectNeedsPlanning,
  type ForecastNode, type LaneBlock,
} from '../../../lib/backlog/pickup.js';
import { buildClassifyLookups } from '../../../lib/backlog/lookups.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { getBacklogSequenceForRoot, clearBacklogSequence } from '../../../lib/overdeck/backlog.js';
import { SEQUENCER_AGENT_ID } from '../../../lib/backlog/sequencer-agent.js';
import { resolvePiSessionPath } from './jsonl-resolver.js';
import {
  clearFinishedSequencerRun,
  getSequencerRunStatus,
  spawnSequencerAgent,
} from '../../../lib/backlog/sequencer-agent.js';
import type { PassMode } from '../../../lib/backlog/types.js';

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

        // Join issue titles from the in-memory read-model issue service so the
        // detail panel can show the title (the sequence cache stores only the id).
        // getIssues() is the hot in-memory path — no disk I/O per request.
        const titleByIssue = new Map<string, string>();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getSharedIssueService } = require('../services/issue-service-singleton.js') as typeof import('../services/issue-service-singleton.js');
          for (const issue of getSharedIssueService().getIssues() as Array<Record<string, unknown>>) {
            const id = typeof issue['identifier'] === 'string' ? issue['identifier'].toUpperCase() : '';
            const title = typeof issue['title'] === 'string' ? issue['title'] : '';
            if (id && title) titleByIssue.set(id, title);
          }
        } catch { /* issue service not ready — titles are optional */ }

        // Per-issue pipeline state from the shared classifier (single source of truth)
        // so the editor drawer can read/toggle ready / parked / vetoed / blocks-main.
        const lookups = buildClassifyLookups(projectRoot);

        const nodes = cachedNodes.map((r) => {
          const issueUpper = r.issueId.toUpperCase();
          const reviewStatus = getReviewStatusSync(issueUpper);
          const inPipeline =
            (reviewStatus !== null && reviewStatus.reviewStatus !== 'pending') ||
            existsSync(join(workspacesDir, `feature-${r.issueId.toLowerCase()}`));
          const hasPrd = prdFiles.has(issueUpper);
          const ready = specIssues.has(issueUpper) && issuesWithBeads.has(issueUpper);
          const state = classifyIssue({ issue: r.issueId, gate: r.gate } as unknown as Parameters<typeof classifyIssue>[0], lookups);
          return {
            issueId: r.issueId,
            title: titleByIssue.get(issueUpper),
            rank: r.rank,
            size: r.size,
            importance: r.importance,
            score: r.score,
            condition: r.condition,
            dependsOn: r.dependsOn,
            isEpic: (r as { isEpic?: boolean }).isEpic ?? false,
            why: r.why,
            gate: r.gate,
            planning: r.planning,
            inPipeline,
            hasPrd,
            ready,
            state,
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
      // Raw dashboard read-model issues — spawnSequencerAgent normalizes them
      // into tracker `Issue` objects (their human ref is `identifier`, not `ref`).
      const issues = getSharedIssueService().getIssues() as Array<Record<string, unknown>>;
      try {
        await clearFinishedSequencerRun(projectRoot);
        const agent = await spawnSequencerAgent(pass, { projectRoot, issues });
        return jsonResponse({ status: 'spawned', agentId: agent.id, pass });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The sequencer is a singleton: spawnRun refuses if a tmux session named
        // `sequencer-runner` already exists (running OR stuck/errored). Surface
        // that as an actionable 409 instead of letting it bubble up as an
        // unhandled 500 with a raw stack — the operator must stop the existing
        // pass first. (PAN-1866: a stuck Haiku pass that overflowed its context
        // blocked every retry with an opaque "HTTP 500".)
        if (/already running/i.test(message)) {
          return jsonResponse(
            {
              error:
                'A sequencer pass is already running (or stuck). Stop it first — use Stop on the ' +
                'sequencer in the dashboard, or run `pan kill sequencer-runner` — then start a new pass.',
              code: 'sequencer_already_running',
            },
            { status: 409 },
          );
        }
        console.error('[backlog] sequencer spawn failed:', message);
        return jsonResponse({ error: `Could not start the sequencer: ${message}` }, { status: 500 });
      }
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
    const rawGate = String(body['gate'] ?? '');

    if (!issueId) return yield* Effect.fail(new Error('issueId is required') as never);
    // Accept the PAN-2006 vocabulary (auto/promote/vetoed) and the legacy
    // spellings (ready/blocked) as aliases during the cutover.
    if (!['auto', 'promote', 'vetoed', 'ready', 'blocked'].includes(rawGate))
      return yield* Effect.fail(new Error('gate must be auto, promote, or vetoed') as never);
    const gate = normalizeGate(rawGate); // 'auto' | 'promote' | 'vetoed'

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

      // sequence.md keeps the legacy NodeGate spelling (auto/ready/blocked) to avoid a
      // schema migration; promote→ready, vetoed→blocked. The vocabulary is normalized on read.
      node.gate = gate === 'vetoed' ? 'blocked' : gate === 'promote' ? 'ready' : 'auto';
      writeSequenceMd(projectRoot, doc, { operatorEdit: true });

      // Mirror the hard veto to the `vetoed` GitHub label so it's visible + queryable
      // and honored by pickFromSequence; clear it when the gate is relaxed.
      if (gate === 'vetoed') await applyIssueVetoedLabel(issueId);
      else await removeIssueVetoedLabel(issueId);

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

// ─── Route: GET /api/backlog/forecast ─────────────────────────────────────────
// PAN-2005: the pickup forecast (waves / lanes / cohort / stats) computed entirely
// from the shared pickup module so the UI can never diverge from the Flywheel.

const getBacklogForecastRoute = HttpRouter.add(
  'GET',
  '/api/backlog/forecast',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const n = Math.max(1, Math.min(20, Number.parseInt(url.searchParams.get('n') ?? '5', 10) || 5));
    return yield* Effect.try({
      try: () => {
        const projectRoot = process.cwd();
        const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
        if (!existsSync(seqPath)) {
          return jsonResponse({ n, stats: null, inFlight: [], needsPlanning: [], waves: [], lanes: { blocks: [], makespan: 0 }, cohort: [], epics: [], contains: [] });
        }
        const parsed = parseSequenceMd(readFileSync(seqPath, 'utf-8'));
        if (!parsed.ok) throw new Error(`parse error: ${parsed.error}`);
        const nodes = parsed.doc.nodes;
        const lk = buildClassifyLookups(projectRoot);

        // Per-issue display meta (title/importance/score/why) to enrich the module's
        // ForecastNode (which only carries issue/rank/size/state).
        const titleByIssue = new Map<string, string>();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getSharedIssueService } = require('../services/issue-service-singleton.js') as typeof import('../services/issue-service-singleton.js');
          for (const issue of getSharedIssueService().getIssues() as Array<Record<string, unknown>>) {
            const id = typeof issue['identifier'] === 'string' ? issue['identifier'].toUpperCase() : '';
            const title = typeof issue['title'] === 'string' ? issue['title'] : '';
            if (id && title) titleByIssue.set(id, title);
          }
        } catch { /* titles optional */ }
        const metaById = new Map(nodes.map((x) => [x.issue, x]));
        const enrich = (f: ForecastNode) => {
          const m = metaById.get(f.issue);
          return {
            ...f,
            title: titleByIssue.get(f.issue.toUpperCase()) ?? '',
            importance: m?.importance ?? 'medium',
            score: m?.score ?? 0,
            why: m?.why ?? '',
          };
        };

        const inFlight = nodes
          .map((x) => ({ issue: x.issue, rank: x.rank, size: x.size, state: classifyIssue(x, lk) }))
          .filter((x) => x.state.inPipeline)
          .sort((a, b) => a.rank - b.rank)
          .map(enrich);
        const needsPlanning = selectNeedsPlanning(nodes, lk, { cap: n * 2 }).map(enrich);
        const waves = computeWaves(nodes, lk, n).map((w) => w.map(enrich));
        const lanesRaw = computeLanes(nodes, lk, n);
        const lanes = {
          makespan: lanesRaw.makespan,
          blocks: lanesRaw.blocks.map((b: LaneBlock) => ({ ...enrich(b), lane: b.lane, start: b.start, end: b.end })),
        };
        const cohort = computeCohort(nodes, lk, n);
        const stats = computeStats(nodes, lk);
        const groups = computeEpicGroups(nodes, parsed.doc.edges, lk);
        const epics = groups.epics.map((e) => ({
          issue: e.issue,
          title: titleByIssue.get(e.issue.toUpperCase()) ?? '',
        }));

        return jsonResponse({ n, stats, inFlight, needsPlanning, waves, lanes, cohort, epics, contains: groups.contains });
      },
      catch: (err) => new Error(String(err)),
    });
  })),
);

// ─── Route: POST /api/backlog/sequence/labels — editor toggles (PAN-2006 WI-8) ─

const postBacklogLabelsRoute = HttpRouter.add(
  'POST',
  '/api/backlog/sequence/labels',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const issueId = String(body['issueId'] ?? '');
    if (!issueId) return yield* Effect.fail(new Error('issueId is required') as never);

    return yield* Effect.promise(async () => {
      if (typeof body['ready'] === 'boolean') await (body['ready'] ? applyIssueReadyLabel : removeIssueReadyLabel)(issueId);
      if (typeof body['parked'] === 'boolean') await (body['parked'] ? applyIssueParkedLabel : removeIssueParkedLabel)(issueId);
      if (typeof body['blocksMain'] === 'boolean') await (body['blocksMain'] ? applyIssueBlocksMainLabel : removeIssueBlocksMainLabel)(issueId);
      // PAN-2059 pickup-gate toggles. Release (operator's "go" after reviewing the plan)
      // and Objection override/clear both flow through here.
      if (typeof body['released'] === 'boolean') await (body['released'] ? applyIssueReleasedLabel : removeIssueReleasedLabel)(issueId);
      if (typeof body['objection'] === 'boolean') await (body['objection'] ? applyIssueObjectionLabel : removeIssueObjectionLabel)(issueId);
      return jsonResponse({ status: 'ok', issueId });
    });
  })),
);

// ─── Route: GET /api/backlog/issue-state — single-issue pickup state (PAN-2059) ─
// Focused per-issue read for the issue cockpit / overlay pickup controls so they
// don't pull the whole 549-node sequence. Same classifier as /sequence (single
// source of truth). Works even when the issue isn't in sequence.md: state is
// label-derived; gate/planning then return defaults with inSequence=false (the UI
// hides the sequence-only gate/planning controls in that case).

const getBacklogIssueStateRoute = HttpRouter.add(
  'GET',
  '/api/backlog/issue-state',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const issueId = (url.searchParams.get('issueId') ?? '').trim();
    if (!issueId) return yield* Effect.fail(new Error('issueId is required') as never);
    return yield* Effect.try({
      try: () => {
        const projectRoot = process.cwd();
        const lookups = buildClassifyLookups(projectRoot);

        // Pull the operator gate + planning mode from sequence.md when the issue is
        // ranked there; otherwise leave them at defaults and flag inSequence=false.
        let gate = 'auto';
        let planning: string | null = null;
        let inSequence = false;
        const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
        if (existsSync(seqPath)) {
          const parsed = parseSequenceMd(readFileSync(seqPath, 'utf-8'));
          if (parsed.ok) {
            const node = parsed.doc.nodes.find((n) => n.issue.toUpperCase() === issueId.toUpperCase());
            if (node) { gate = node.gate; planning = node.planning; inSequence = true; }
          }
        }

        const state = classifyIssue({ issue: issueId, gate } as unknown as Parameters<typeof classifyIssue>[0], lookups);
        return jsonResponse({ issueId, state, gate, planning, inSequence });
      },
      catch: (err) => new Error(String(err)),
    });
  })),
);

// ─── Route: POST /api/backlog/sequence/clear — delete the sequencing ──────────
// Removes the ranked sequence (sequence.md + the disposable DB cache). Recoverable:
// a re-sequence pass regenerates it. The operator gate fields live in sequence.md, so
// clearing also drops operator overrides — intentional ("delete the sequencing").

const postBacklogClearRoute = HttpRouter.add(
  'POST',
  '/api/backlog/sequence/clear',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    return yield* Effect.try({
      try: () => {
        const projectRoot = process.cwd();
        const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
        // Clear the cache under the project key recorded in the md (if parseable).
        if (existsSync(seqPath)) {
          const parsed = parseSequenceMd(readFileSync(seqPath, 'utf-8'));
          if (parsed.ok) clearBacklogSequence(parsed.doc.project);
          rmSync(seqPath, { force: true });
        }
        return jsonResponse({ status: 'ok', cleared: true });
      },
      catch: (err) => new Error(String(err)),
    });
  })),
);

// ─── Route: GET /api/backlog/sequencer-status — live pass progress ────────────
// The sequencer is a single LLM pass with no per-issue telemetry, so "processed" is a
// best-effort count of distinct issue ids the agent has emitted in its OUTPUT (assistant
// messages) so far — the input manifest (which lists all ids) is excluded. total = the
// manifest the pass is ranking. Lets the UI show a live "ranking X of Y" indicator.

const getSequencerStatusRoute = HttpRouter.add(
  'GET',
  '/api/backlog/sequencer-status',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      const projectRoot = process.cwd();
      // The one-shot sequencer session lingers after it finishes, so "alive" alone
      // would falsely read as running. A pass is done once it writes a fresh
      // sequence.md (mtime >= startedAt) or its runtime is idle.
      const { running, startedAt } = getSequencerRunStatus(projectRoot);

      let total = 0;
      const manifestPath = join(projectRoot, '.pan', 'backlog', 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
          const arr = Array.isArray(m) ? m : ((m as { issues?: unknown[]; nodes?: unknown[] })?.issues ?? (m as { nodes?: unknown[] })?.nodes ?? []);
          total = Array.isArray(arr) ? arr.length : 0;
        } catch { /* manifest unreadable */ }
      }

      let processed = 0;
      if (running) {
        try {
          const tx = await resolvePiSessionPath(SEQUENCER_AGENT_ID);
          if (tx && existsSync(tx)) {
            const ids = new Set<string>();
            for (const line of readFileSync(tx, 'utf-8').split('\n')) {
              if (!line) continue;
              try {
                const j = JSON.parse(line) as { message?: { role?: string; content?: unknown } };
                if (j.message?.role !== 'assistant') continue;
                const c = typeof j.message.content === 'string' ? j.message.content : JSON.stringify(j.message.content);
                for (const id of c.match(/[A-Z]{2,}-\d+/g) ?? []) ids.add(id);
              } catch { /* skip non-JSON line */ }
            }
            processed = total > 0 ? Math.min(ids.size, total) : ids.size;
          }
        } catch { /* transcript not resolvable — leave processed at 0 */ }
      }

      return jsonResponse({ running, total, processed, startedAt });
    });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const backlogRouteLayer = Layer.mergeAll(
  getBacklogSequenceRoute,
  postBacklogRegenerateRoute,
  postBacklogGateRoute,
  postBacklogPlanningRoute,
  getBacklogForecastRoute,
  postBacklogLabelsRoute,
  getBacklogIssueStateRoute,
  postBacklogClearRoute,
  getSequencerStatusRoute,
);

export default backlogRouteLayer;
