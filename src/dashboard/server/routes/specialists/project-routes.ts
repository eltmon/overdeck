import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getClaudePermissionFlagsStringSync } from '../../../../lib/claude-permissions.js';
import { normalizeModelName } from '../../../../lib/cost-parsers/jsonl-parser.js';
import { calculateCostSync, getPricingSync, type TokenUsage } from '../../../../lib/cost.js';
import { loadConfigSync, resolveModel } from '../../../../lib/config-yaml.js';
import { encodeClaudeProjectDir } from '../../../../lib/paths.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { getReviewStatusSync } from '../../../../lib/review-status.js';
import { getAgentCommandSync } from '../../../../lib/settings.js';
import { killSession } from '../../../../lib/tmux.js';
import { saveAgentRuntimeState } from '../../../../lib/agents.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { execAsync, readJsonBody, validateSpecialistAgentName } from './shared.js';

// ─── Route: GET /api/specialists/:project/:issueId/:type/status ───────────────
//
// PAN-1048 review feedback 003 (REQ-16): the legacy specialist-status route
// returned metadata sourced from ~/.overdeck/specialists/registry.json, which
// the role-primitive refactor explicitly retires. The startup cleanup in
// service.ts deletes that directory on every boot; preserving the read path
// would silently recreate it via getRunMetadata() → loadRegistry()/saveRegistry().
//
// The route is now a 410 Gone with a pointer to the role-aware status surface.
// The frontend's only caller (AgentOutputPanel) only fires when
// parseSpecialistSession(agentId) matches the legacy `specialist-…` session
// naming, which the new role spawns no longer use, so the dead-letter response
// is invisible to current dashboards.

const getProjectSpecialistStatusRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:issueId/:type/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return jsonResponse(
      {
        error: 'specialist-status route retired',
        hint: 'Specialist identity is replaced by the role primitive. Use GET /api/agents and read the role/status fields off the AgentSnapshot for the role-scoped session (e.g. agent-pan-509-review).',
        retiredFor: {
          project: params['project'],
          issueId: params['issueId'],
          type: params['type'],
        },
      },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/:type/kill ───────────────

const postProjectSpecialistKillRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/:type/kill',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { getTmuxSessionName, makeSpecialistRegistryKey, getRunMetadata } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));

    const registryKey = makeSpecialistRegistryKey(type, issueId);
    const tmuxSession = getRunMetadata(project, registryKey).tmuxSession
      ?? getTmuxSessionName(type, project, issueId);

    yield* Effect.promise(() => Effect.runPromise(killSession(tmuxSession)).catch(() => {}));
    // Leave Claude JSONL/session artifacts intact; only reset Overdeck runtime state.
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    return jsonResponse({
      success: true,
      message: `Killed ${type} (${project}/${issueId})`,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/spawn ───────────────────────
//
// PAN-1048 R1: removed. The legacy /spawn endpoint dispatched arbitrary
// "specialist types" (review-agent, test-agent, merge-agent) by issuing a
// generic spawnEphemeralSpecialist call. Under the role primitive, review/test
// dispatch through lifecycle-aware role paths. Shipping is now server-side;
// `ship` remains only as the merge-specialist identity for model routing and
// historical activity attribution. The endpoint had no remaining in-tree caller
// and is replaced by reactive Cloister scheduling on issue state transitions
// plus the role spawn primitive.
//
// Old shape (removed):
//   POST /api/specialists/:project/:type/spawn { issueId, branch, ... }
//
// Replacement: drive role spawns via lifecycle.transitionTo() and the
// reactive scheduler in src/lib/cloister/service.ts.

// ─── Route: GET /api/specialists/:project/:type/runs ──────────────────────────

const getProjectSpecialistRunsRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);

    let limit: number | undefined;
    let offset = 0;

    if (Option.isSome(urlOpt)) {
      const sp = urlOpt.value.searchParams;
      const limitParam = sp.get('limit');
      const offsetParam = sp.get('offset');
      if (limitParam) limit = parseInt(limitParam, 10);
      if (offsetParam) offset = parseInt(offsetParam, 10);
    }

    const { listRunLogsSync } = yield* Effect.promise(() => import('../../../../lib/cloister/specialist-logs.js'));
    const runs = listRunLogsSync(project, type, { limit, offset });
    return jsonResponse(runs);
  })),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId/stream ────────────
// NOTE: Must be registered before /:project/:type/runs/:runId to avoid route conflict.

const getProjectSpecialistRunStreamRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId/stream',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    const { getRunLogPath, isRunLogActive } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialist-logs.js'));

        const logPath = getRunLogPath(project, type, runId);

        if (!existsSync(logPath)) {
          return jsonResponse({ error: 'Run log not found' }, { status: 404 });
        }

        // Build an SSE stream using Effect Stream + Node ReadableStream
        const encoder = new TextEncoder();

        const nodeStream = new ReadableStream({
          async start(controller) {
            // Send initial content
            const content = await readFile(logPath, 'utf-8').catch(() => '');
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'content', data: content })}\n\n`,
              ),
            );
            let lastSize = content.length;

            // Poll for updates
            const poll = async () => {
              if (!isRunLogActive(project, type, runId)) {
                // Log completed — send final update and close
                try {
                  const finalContent = await readFile(logPath, 'utf-8');
                  if (finalContent.length > lastSize) {
                    const newContent = finalContent.substring(lastSize);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`,
                      ),
                    );
                  }
                } catch {}
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`),
                );
                controller.close();
                return;
              }

              try {
                const currentContent = await readFile(logPath, 'utf-8');
                if (currentContent.length > lastSize) {
                  const newContent = currentContent.substring(lastSize);
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`,
                    ),
                  );
                  lastSize = currentContent.length;
                }
              } catch {}

              await new Promise((r) => setTimeout(r, 1000));
              await poll();
            };

            await new Promise((r) => setTimeout(r, 1000));
            await poll();
          },
        });

        const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
          evaluate: () => nodeStream,
          onError: (err) => err,
        });

        return HttpServerResponse.stream(effectStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
  })),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId ───────────────────

const getProjectSpecialistRunRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    const { getRunLogSync, parseLogMetadata } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialist-logs.js'));
    const content = getRunLogSync(project, type, runId);

    if (!content) {
      return jsonResponse({ error: 'Run log not found' }, { status: 404 });
    }

    const metadata = parseLogMetadata(content);
    return jsonResponse({ runId, content, metadata });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/runs/:runId/terminate ────────

const postProjectSpecialistRunTerminateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/runs/:runId/terminate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { terminateSpecialist } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    yield* Effect.promise(() => terminateSpecialist(project, type));
    return jsonResponse({ success: true, message: 'Specialist terminated' });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/pause ──────────────────

const postProjectSpecialistGracePauseRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/pause',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { pauseGracePeriod } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    const success = pauseGracePeriod(project, type);

    if (success) {
      return jsonResponse({ success: true, message: 'Grace period paused' });
    } else {
      return jsonResponse(
        { error: 'No active grace period to pause' },
        { status: 400 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/resume ─────────────────

const postProjectSpecialistGraceResumeRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/resume',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { resumeGracePeriod } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    const success = resumeGracePeriod(project, type);

    if (success) {
      return jsonResponse({ success: true, message: 'Grace period resumed' });
    } else {
      return jsonResponse(
        { error: 'No paused grace period to resume' },
        { status: 400 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/exit ───────────────────

const postProjectSpecialistGraceExitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/exit',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { exitGracePeriod } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    exitGracePeriod(project, type);
    return jsonResponse({
      success: true,
      message: 'Specialist terminated immediately',
    });
  })),
);

// ─── Route: GET /api/specialists/:project/:type/grace ────────────────────────

const getProjectSpecialistGraceRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/grace',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { getGracePeriodState } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    const state = getGracePeriodState(project, type);

    if (state) {
      return jsonResponse(state);
    } else {
      return jsonResponse({ error: 'No active grace period' }, { status: 404 });
    }
  })),
);

// ─── Route: GET /api/specialists/:project/:type/context ──────────────────────

const getProjectSpecialistContextRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/context',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { loadContextDigest } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialist-context.js'));
    const digest = loadContextDigest(project, type);

    if (digest) {
      return jsonResponse({ digest });
    } else {
      return jsonResponse({ error: 'No context digest found' }, { status: 404 });
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/context/regenerate ───────────

const postProjectSpecialistContextRegenerateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/context/regenerate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { regenerateContextDigest } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialist-context.js'));
    const digest = yield* Effect.promise(() => regenerateContextDigest(project, type));

    if (digest) {
      return jsonResponse({ digest, message: 'Context digest regenerated' });
    } else {
      return jsonResponse(
        { error: 'Failed to generate context digest' },
        { status: 500 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/complete ─────────────────────

const postProjectSpecialistCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/complete',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const body = yield* readJsonBody;
    const { status, notes, issueId } = body as { status?: string; notes?: string; issueId?: string };

    if (!status || !['passed', 'failed', 'blocked'].includes(status)) {
      return jsonResponse(
        { error: 'Valid status (passed/failed/blocked) is required' },
        { status: 400 },
      );
    }

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { signalSpecialistCompletion } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    signalSpecialistCompletion(project, type, { status: status as 'passed' | 'failed' | 'blocked', notes }, issueId);
    return jsonResponse({
      success: true,
      message: 'Specialist completion signaled, grace period started',
    });
  })),
);

// ─── Route: GET /api/specialists/:project/:type/latest-log ───────────────────

const getProjectSpecialistLatestLogRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/latest-log',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const runsDir = join(homedir(), '.overdeck', 'specialists', project, type, 'runs');
    if (!existsSync(runsDir)) {
      return jsonResponse({ log: null, message: 'No runs found' });
    }

    const files = (yield* Effect.promise(() => readdir(runsDir)))
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return jsonResponse({ log: null, message: 'No run logs found' });
    }

    const latestLog = yield* Effect.promise(() => readFile(join(runsDir, files[0]), 'utf-8'));
    return jsonResponse({
      log: latestLog,
      file: files[0],
      totalRuns: files.length,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/logs/cleanup ────────────────

const postProjectSpecialistLogsCleanupRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/logs/cleanup',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { cleanupOldLogsSync } = yield* Effect.promise(() => import('../../../../lib/cloister/specialist-logs.js'));
    const { getSpecialistRetention } = yield* Effect.promise(() => import('../../../../lib/projects.js'));

    const retention = getSpecialistRetention(project);
    const deleted = cleanupOldLogsSync(project, type, { maxDays: retention.max_days, maxRuns: retention.max_runs });

    return jsonResponse({
      success: true,
      deleted,
      message: `Cleaned up ${deleted} old logs`,
    });
  })),
);

// ─── Route: POST /api/specialists/projects/:project/:name/reset-session ───────
// Bumps the session generation so the next dispatch starts a fresh Claude session.
// Old JSONL files are preserved.

const postProjectSpecialistResetSessionRoute = HttpRouter.add(
  'POST',
  '/api/specialists/projects/:project/:name/reset-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const projectKey = params['project'] ?? '';
    const name = params['name'] ?? '';
    return jsonResponse(
      { error: `Legacy specialist session rotation is no longer supported for ${projectKey}/${name}.` },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/review/restart ───────────
// Kills all reviewer tmux sessions + coordinator, wipes the review agent
// state directories (PAN-1985), then dispatches a fresh review through the
// role primitive. The new review starts with a fresh `state.json` and a new
// session id because the old dirs are gone.
//
// Convoy view vs Quick Review view is purely a presentation concern (the
// menu label is "Restart All" vs "Restart"); the route behavior is the
// same for both. Wipe+respawn is the deliberate override path for harness/
// model switches — the NORMAL review flow continues the same session
// across re-dispatches (PAN-1862), and this endpoint is the escape hatch
// that pays the re-research cost.

const postProjectReviewRestartRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/review/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const body = yield* readJsonBody;
    const { model, harness } = body as { model?: string; harness?: 'claude-code' | 'pi' | 'codex' };

    const { killAllReviewerSessions } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    const killResult = yield* killAllReviewerSessions(project, issueId);

    // PAN-1862: do NOT wipe here. The review session (state.json + saved session id) is preserved
    // so spawnReviewRoleForIssue can RESUME it — keeping the prior review's context so a restart
    // with the same model checks the fix instead of re-researching the whole diff. It wipes +
    // fresh-spawns internally ONLY when the harness/model actually changed.

    // Resolve workspace info for re-dispatch
    const projectConfig = resolveProjectFromIssueSync(issueId);
    if (!projectConfig) {
      return jsonResponse({ error: `Cannot resolve project for ${issueId}` }, { status: 404 });
    }
    const workspacePath = join(projectConfig.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: `Workspace not found: ${workspacePath}` }, { status: 404 });
    }

    // Detect branch
    let branch = 'unknown';
    try {
      const { stdout } = yield* Effect.promise(() => execAsync(
        `cd "${workspacePath}" && git branch --show-current`,
        { encoding: 'utf-8', timeout: 5000 },
      ));
      branch = stdout.trim() || 'unknown';
    } catch { /* non-fatal */ }

    // PAN-1048 R3: review now spawns through the role primitive.
    const { spawnReviewRoleForIssue } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    const prUrl = getReviewStatusSync(issueId)?.prUrl;
    const result = yield* spawnReviewRoleForIssue({
      issueId,
      workspace: workspacePath,
      branch,
      prUrl,
      model,
      harness,
    });

    if (result.gated) {
      return jsonResponse({
        success: false,
        gated: true,
        message: result.message,
        killed: killResult.killed,
        wiped: [],
        model: model ?? undefined,
        harness: harness ?? undefined,
      }, { status: 409 });
    }

    return jsonResponse({
      success: result.success,
      message: result.message,
      killed: killResult.killed,
      wiped: [],
      model: model ?? undefined,
      harness: harness ?? undefined,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/reviewer/:role/restart ───
//
// PAN-1048 review feedback 005 (C5): the per-reviewer restart endpoint is
// retired. The role primitive launches the four code-review-* sub-agents in a
// single review-role run via the Agent tool — there is no longer a per-axis
// tmux session to restart, no `pan-review-agent` shell to relaunch, and no
// per-reviewer prompt file to feed back in. Returning 410 with a pointer to
// the supported restart surface keeps any frontend cache/intent that still
// hits this URL from silently re-establishing the legacy machinery.

const postProjectReviewerRoleRestartRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/reviewer/:role/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return jsonResponse(
      {
        error: 'per-reviewer restart route retired',
        hint: 'The review role launches all four code-review-* sub-agents in a single run via the Agent tool. To re-run a review, POST /api/review/:issueId/trigger (full review restart through spawnReviewRoleForIssue), which dispatches role: review and re-fans-out the convoy.',
        retiredFor: {
          project: params['project'],
          issueId: params['issueId'],
          role: params['role'],
        },
      },
      { status: 410 },
    );
  })),
);

// ─── Route: GET /api/models/resolve ──────────────────────────────────────────
// Returns the resolved default model for each session/work type.

const getModelsResolveRoute = HttpRouter.add(
  'GET',
  '/api/models/resolve',
  httpHandler(Effect.gen(function* () {
    const config = loadConfigSync().config;

    const routes = [
      { key: 'role:plan', role: 'plan' },
      { key: 'role:work', role: 'work' },
      { key: 'role:work.inspect', role: 'work', subRole: 'inspect' },
      { key: 'role:work.inspect-deep', role: 'work', subRole: 'inspect-deep' },
      { key: 'role:strike', role: 'strike' },
      { key: 'role:review', role: 'review' },
      { key: 'role:review.correctness', role: 'review', subRole: 'correctness' },
      { key: 'role:review.security', role: 'review', subRole: 'security' },
      { key: 'role:review.performance', role: 'review', subRole: 'performance' },
      { key: 'role:review.requirements', role: 'review', subRole: 'requirements' },
      { key: 'role:test', role: 'test' },
      { key: 'role:ship', role: 'ship' },
    ] as const;

    const resolved: Record<string, string | null> = {};
    for (const route of routes) {
      try {
        resolved[route.key] = resolveModel(route.role, (route as { subRole?: string }).subRole, config);
      } catch {
        resolved[route.key] = null;
      }
    }

    return jsonResponse(resolved);
  })),
);

export const specialistsProjectRouteLayer = Layer.mergeAll(
  // PAN-1048 R1: postProjectSpecialistSpawnRoute removed (see above).
  getProjectSpecialistStatusRoute,
  postProjectSpecialistKillRoute,
  getProjectSpecialistRunsRoute,
  getProjectSpecialistRunStreamRoute,       // /runs/:runId/stream — before /runs/:runId
  getProjectSpecialistRunRoute,             // /runs/:runId
  postProjectSpecialistRunTerminateRoute,   // /runs/:runId/terminate
  postProjectSpecialistGracePauseRoute,     // /grace/pause
  postProjectSpecialistGraceResumeRoute,    // /grace/resume
  postProjectSpecialistGraceExitRoute,      // /grace/exit
  getProjectSpecialistGraceRoute,           // /grace
  getProjectSpecialistContextRoute,         // /context
  postProjectSpecialistContextRegenerateRoute, // /context/regenerate
  postProjectSpecialistCompleteRoute,       // /complete
  getProjectSpecialistLatestLogRoute,       // /latest-log
  postProjectSpecialistLogsCleanupRoute,    // /logs/cleanup
  postProjectSpecialistResetSessionRoute,  // /reset-session
  postProjectReviewRestartRoute,           // /:project/:issueId/review/restart
  postProjectReviewerRoleRestartRoute,     // /:project/:issueId/reviewer/:role/restart
  getModelsResolveRoute,                   // /models/resolve
);
