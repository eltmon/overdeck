import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import type { RuntimeName } from '../../../../lib/runtimes/types.js';
import { resolveStaffing } from '../../../../lib/agents/staffing.js';
import { findPlanSync, readWorkspacePlanSync } from '../../../../lib/vbrief/io.js';
import { resolveTieredExecutionEnabled, resolveTieredExecutionEnabledForIssue } from '../../../../lib/agents/tier-table.js';
import { getDispatchableItems } from '../../../../lib/vbrief/dag.js';
import { loadConfigSync } from '../../../../lib/config-yaml.js';

import {
  getAgentState,
  getLatestSessionId,
  recoverAgent,
  resumeAgent,
  restartAgent,
  saveAgentStateSync,
  getAgentDir,
  getProviderAuthMode,
  listRunningAgents,
  wipeAgentStateDirs,
} from '../../../../lib/agents.js';
import { canUseHarnessSync } from '../../../../lib/harness-policy.js';
import { normalizeModelOverrideSync, requireModelOverrideSync } from '../../../../lib/model-validation.js';
import { operatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { killSession } from '../../../../lib/tmux.js';
import { saveAgentStateAndEmitEventProgram } from '../../services/agent-projection.js';
import { EventStoreService } from '../../services/domain-services.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  appendAgentLifecycleLog,
  buildPanStartArgs,
  invalidateAgentsCache,
  readJsonBody,
  spawnPanCommandDetached,
} from './shared.js';

// ─── Route: POST /api/agents/:id/resume ──────────────────────────────────────

export const postAgentResumeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/resume',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { message, model, harness, compact } = body as { message?: string; model?: string; harness?: RuntimeName; compact?: boolean };
    let resumeModel: string | undefined;
    try {
      resumeModel = normalizeModelOverrideSync(model);
    } catch (err) {
      console.warn(`[agents/resume] ${id} model validation failed: ${err instanceof Error ? err.message : String(err)}`);
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    // PAN-1985 follow-up: structured log at the route entry so the operator
    // can trace every resume attempt in the server console / pty-supervisor
    // log even when the front-end's toast is missed.
    console.log(`[agents/resume] ${id} requested: model=${resumeModel ?? 'unchanged'} harness=${harness ?? 'unchanged'} hasMessage=${!!message} compact=${compact === true}`);
    const eventStore = yield* EventStoreService;
    // Snapshot lifecycle state BEFORE taking any action so callers can see the
    // temporal context (why was this resume allowed) without recomputing state.
    const lifecycleBefore = yield* getWorkAgentLifecycleState(id);
    console.log(`[agents/resume] ${id} lifecycle: canResume=${lifecycleBefore.canResumeSession} hasSavedSession=${lifecycleBefore.hasSavedSession} hasLiveTmux=${lifecycleBefore.hasLiveTmuxSession} isCrashed=${lifecycleBefore.isCrashed} isStopped=${lifecycleBefore.isStopped}`);
    // PAN-1675: a compact-resume targets a context-wedged agent that is usually
    // still 'running' (a live but stuck session), which the normal gate rejects.
    // Allow it through for compact === true — resumeAgent summarizes the wedged
    // session out-of-band, kills it, and respawns a fresh session seeded with
    // the summary (PAN-1781; its own canResume handles the running case).
    // Non-compact resumes keep the strict gate.
    if (!lifecycleBefore.canResumeSession && !lifecycleBefore.isRunningButStuck && compact !== true) {
      console.warn(`[agents/resume] ${id} rejected: ${lifecycleBefore.reason}`);
      return jsonResponse({
        error: lifecycleBefore.reason || `Cannot resume agent ${lifecycleBefore.agentId}`,
        lifecycle: lifecycleBefore,
      }, { status: 409 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_requested', {
      hasMessage: !!message,
      model: resumeModel || undefined,
      harness: harness || undefined,
      lifecycle: lifecycleBefore,
    }));
    const resumeOpts = resumeModel || harness || compact === true
      ? { ...(resumeModel ? { model: resumeModel } : {}), ...(harness ? { harness } : {}), ...(compact === true ? { compact: true } : {}) }
      : undefined;
    console.log(`[agents/resume] ${id} dispatching resumeAgent() with opts=${JSON.stringify(resumeOpts)}`);
    const result = yield* Effect.promise(() => resumeAgent(id, message, resumeOpts));
    console.log(`[agents/resume] ${id} resumeAgent returned: success=${result.success} messageDelivered=${result.messageDelivered} error=${result.error ?? 'none'}`);
    if (result.success) {
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction so the read model transitions agent
      // status from 'stopped' → 'running' and the frontend updates immediately.
      const agentState = yield* getAgentState(id);
      if (agentState) {
        yield* saveAgentStateAndEmitEventProgram(agentState, {
          type: 'agent.started',
          timestamp: new Date().toISOString(),
          payload: {
            agentId: id,
            issueId: agentState.issueId,
            agent: {
              id,
              issueId: agentState.issueId,
              workspace: agentState.workspace,
              runtime: agentState.harness ?? 'claude-code',
              model: agentState.model,
              status: 'running',
              startedAt: agentState.startedAt,
              lastActivity: new Date().toISOString(),
              role: agentState.role ?? 'work',
            },
          },
        });
      }
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_succeeded', {
        hasMessage: !!message,
        messageDelivered: result.messageDelivered !== false,
      }));
      invalidateAgentsCache();
      // PAN-1985 follow-up: the messageDelivered flag distinguishes "agent is
      // resumed and your message landed in its composer" from "agent is
      // resumed but your message did NOT land in its composer (PTY supervisor
      // echo-confirm timed out, harness/session.id mismatch, etc.)". The
      // former gets a 'delivered' toast; the latter gets a clear 'queued in
      // mail' warning so the operator can intervene if needed.
      const delivered = result.messageDelivered !== false;
      console.log(`[agents/resume] ${id} returning: success=${true} delivered=${delivered}`);
      return jsonResponse({
        success: true,
        resumed: true,
        messageDelivered: delivered,
        hint: delivered
          ? 'Continue prompt delivered to the agent.'
          : 'The continue prompt was queued in the agent mail/ folder because the live delivery path did not confirm in time. The agent will read it on its next session start.',
        lifecycle: { before: lifecycleBefore, after: yield* getWorkAgentLifecycleState(id) },
      });
    } else {
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_failed', {
        hasMessage: !!message,
        error: result.error,
      }));
      return jsonResponse({
        error: result.error,
        lifecycle: { before: lifecycleBefore, after: yield* getWorkAgentLifecycleState(id) },
      }, { status: 400 });
    }
  })),
);

// ─── Route: POST /api/agents/:id/recover ──────────────────────────────────────

export const postAgentRecoverRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/recover',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { model } = body as { model?: string };
    let recoveryModel: string | undefined;
    try {
      recoveryModel = normalizeModelOverrideSync(model);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const stateBeforeRecover = yield* getAgentState(id);
    if (!stateBeforeRecover) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_requested', {
      model: recoveryModel || undefined,
    }));

    const result = yield* Effect.promise(() => recoverAgent(id, recoveryModel ? { modelOverride: recoveryModel } : undefined));
    if (!result) {
      const error = `Could not recover agent ${id}`;
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_failed', { error }));
      return jsonResponse({ success: false, error }, { status: 400 });
    }

    const updatedState = yield* getAgentState(id);
    if (updatedState) {
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction.
      yield* saveAgentStateAndEmitEventProgram(updatedState, {
        type: 'agent.started',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: id,
          issueId: updatedState.issueId || stateBeforeRecover.issueId || id.replace('agent-', '').toUpperCase(),
          agent: {
            id,
            issueId: updatedState.issueId || stateBeforeRecover.issueId,
            workspace: updatedState.workspace,
            model: updatedState.model,
            status: 'running',
            startedAt: updatedState.startedAt,
            lastActivity: updatedState.lastActivity,
            role: updatedState.role ?? 'work',
          },
        },
      });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_succeeded'));
    invalidateAgentsCache();
    return jsonResponse({ success: true, recovered: true, agent: updatedState ?? null });
  })),
);

// ─── Route: POST /api/agents/:id/restart ──────────────────────────────────────
//
// Restart an agent with optional model override. Graceful mode sends a 30s
// warning then restarts; quick mode kills and relaunches immediately.
// Returns 202 for graceful (async work), 200 for quick.

export const postAgentRestartRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { model, harness, graceful = true, message } = body as {
      model?: string;
      harness?: 'claude-code' | 'ohmypi' | 'codex';
      graceful?: boolean;
      message?: string;
    };
    let restartModel: string | undefined;
    try {
      restartModel = normalizeModelOverrideSync(model);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_requested', {
      model: restartModel || agentState.model,
      harness: harness || undefined,
      graceful,
      hasMessage: !!message,
    }));

    if (graceful) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: agentState.issueId,
        kind: 'restart',
        source: 'dashboard',
      }));
      // Kick off async restart — don't block the HTTP response for 30s
      (async () => {
        try {
          // PAN-1908: write-through projection — agents-row upsert + lifecycle
          // event append in one SQLite transaction.
          await Effect.runPromise(saveAgentStateAndEmitEventProgram(agentState, {
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: id, issueId: agentState.issueId },
          }));

          const result = await restartAgent(id, { model: restartModel, harness, graceful: true, message });

          if (result.success) {
            const updatedState = await Effect.runPromise(getAgentState(id));
            // PAN-1908: write-through projection — agents-row upsert + lifecycle
            // event append in one SQLite transaction.
            if (updatedState) {
              await Effect.runPromise(saveAgentStateAndEmitEventProgram(updatedState, {
                type: 'agent.started',
                timestamp: new Date().toISOString(),
                payload: {
                  agentId: id,
                  issueId: updatedState.issueId || agentState.issueId,
                  agent: {
                    id,
                    issueId: updatedState.issueId || agentState.issueId,
                    workspace: updatedState.workspace || agentState.workspace,
                    // PAN-1048 review feedback 004 (C3): same as quick-restart
                    // below — surface the actual harness so Pi agents do not
                    // get mis-labelled as Claude Code on graceful restart.
                    runtime: updatedState.harness ?? agentState.harness ?? 'claude-code',
                    model: restartModel || updatedState.model || agentState.model,
                    status: 'running',
                    startedAt: updatedState.startedAt || agentState.startedAt,
                    lastActivity: new Date().toISOString(),
                    role: updatedState.role ?? agentState.role,
                  },
                },
              }));
            }
            invalidateAgentsCache();
          }
          await appendAgentLifecycleLog(id, 'agent.restart_completed', {
            success: result.success,
            error: result.error,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[agents] Graceful restart failed for ${id}: ${msg}`);
          await appendAgentLifecycleLog(id, 'agent.restart_failed', { error: msg });
        }
      })();

      return jsonResponse({ accepted: true, graceful: true, agentId: id }, { status: 202 });
    }

    // Quick restart — synchronous
    const result = yield* Effect.promise(() => restartAgent(id, { model: restartModel, harness, graceful: false, message }));

    if (result.success) {
      const updatedState = yield* getAgentState(id);
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState?.issueId || agentState.issueId,
        kind: 'restart',
        source: 'dashboard',
      }));
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction. restartAgent already saved state, but
      // repeating the upsert here makes each lifecycle event atomic.
      if (updatedState) {
        yield* saveAgentStateAndEmitEventProgram(updatedState, {
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId: id, issueId: updatedState.issueId || agentState.issueId },
        });
        yield* saveAgentStateAndEmitEventProgram(updatedState, {
          type: 'agent.started',
          timestamp: new Date().toISOString(),
          payload: {
            agentId: id,
            issueId: updatedState.issueId || agentState.issueId,
            agent: {
              id,
              issueId: updatedState.issueId || agentState.issueId,
              workspace: updatedState.workspace || agentState.workspace,
              // PAN-1048 review feedback 004 (C3): preserve the agent's actual
              // harness instead of hard-coding 'claude'. AgentSnapshot.runtime
              // is what getHarness() reads, so a Pi agent restarted through
              // this path was being mis-labelled as Claude Code.
              runtime: updatedState.harness ?? agentState.harness ?? 'claude-code',
              model: restartModel || updatedState.model || agentState.model,
              status: 'running',
              startedAt: updatedState.startedAt || agentState.startedAt,
              lastActivity: new Date().toISOString(),
              role: updatedState.role ?? agentState.role,
            },
          },
        });
      }
      invalidateAgentsCache();
      return jsonResponse({ success: true, restarted: true, agentId: id, model: restartModel || agentState.model });
    }

    return jsonResponse({ error: result.error }, { status: 500 });
  })),
);

// ─── Route: POST /api/agents/:id/restart-fresh ────────────────────────────────
//
// PAN-1985: wipe the work agent's state directory under ~/.overdeck/agents/,
// then optionally spawn a fresh work agent with a new harness/model. This is
// the deliberate operator override path — for harness/model switches (the
// Claude-session JSONL can't be resumed under a different harness) and for
// "I want a clean work run" recovery. The NORMAL review flow continues the
// same session across re-dispatches (PAN-1862); this route is the escape
// hatch that pays the re-research cost.
//
// Modes (driven by request body):
//   { spawn: true,  model, harness }  — wipe + respawn a new work agent with
//                                       the chosen harness/model
//   { spawn: false }                   — wipe only; user clicks Start afterwards
//                                       (this is the backend of the new
//                                       'completeWorkReset' issue action)
//
// Refuses (409) if a live tmux session is alive — same gate as reset-session.
// Workspace, vBRIEF, beads, .pan/continue.json, .pan/feedback/, the branch,
// and the commit history are all left untouched. The new agent (whether
// auto-spawned or manually started) reads .pan/continue.json + branch state
// to pick up where the prior run left off.

export const postAgentRestartFreshRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/restart-fresh',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { spawn: spawnFlag, model: rawModel, harness } = body as {
      spawn?: boolean;
      model?: string;
      harness?: 'claude-code' | 'ohmypi' | 'codex';
    };
    const wantsSpawn = spawnFlag !== false; // default to spawn when omitted (picker path)

    let newModel: string | undefined;
    if (wantsSpawn && rawModel) {
      try {
        newModel = requireModelOverrideSync(rawModel);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }
    const issueId = agentState.issueId ?? id.replace(/^agent-/, '').toUpperCase();

    const lifecycle = yield* getWorkAgentLifecycleState(id);
    if (lifecycle.hasLiveTmuxSession) {
      return jsonResponse({
        error: `Agent ${id} has a live tmux session. Run 'pan kill ${issueId}' first, then retry.`,
        lifecycle,
      }, { status: 409 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_fresh_requested', {
      wantsSpawn,
      model: newModel,
      harness,
      issueId,
    }));

    // Kill any zombie tmux session (shouldn't happen with the gate above, but
    // belt-and-suspenders) before wiping state.
    yield* killSession(id).pipe(Effect.catch(() => Effect.void));

    // Wipe the work agent dir only — leave specialist dirs (review, etc.)
    // alone. The new agent will read .pan/continue.json to pick up.
    const wipeResult = yield* Effect.promise(() => wipeAgentStateDirs(issueId));
    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_fresh_wiped', {
      removed: wipeResult.removed,
      path: wipeResult.path,
    }));

    if (!wantsSpawn) {
      invalidateAgentsCache();
      return jsonResponse({
        success: true,
        spawn: false,
        agentId: id,
        issueId,
        removed: wipeResult.removed,
        hint: 'Agent dir wiped. Click Start agent to respawn with a fresh session.',
      });
    }

    // Auto-spawn path: dispatch to the existing /api/agents spawn flow.
    // We don't go through HTTP — we call the spawn primitives directly so
    // the caller gets a single 200 with both wipe and spawn confirmed.
    const spawnModel = newModel ?? agentState.model ?? 'claude-sonnet-5';
    let effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | null = null;
    if (harness) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarnessSync(harness, spawnModel, await getProviderAuthMode(spawnModel)),
      );
      effectiveHarness = harnessDecision.allowed ? harness : 'claude-code';
    }

    const agentSessionName = `agent-${issueId.toLowerCase()}`;
    const projectPath = agentState.workspace
      ? dirname(agentState.workspace)
      : undefined;
    const projectConfig = resolveProjectFromIssueSync(issueId);
    const projectRoot = projectConfig?.projectPath ?? projectPath ?? process.cwd();
    const workspacePath = agentState.workspace ?? join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);

    const args = buildPanStartArgs({
      issueId,
      model: spawnModel,
      harness: effectiveHarness,
    });

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.restart_fresh_spawn_requested', {
      args,
      model: spawnModel,
      harness: effectiveHarness,
    }));

    // Spawn detached `pan start` — same pattern the existing POST /api/agents
    // route uses, minus the HTTP hop. We deliberately write a placeholder
    // state.json (matching the existing spawn flow) so the dashboard
    // transitions the agent from "stopped" to "starting" within one refresh.
    saveAgentStateSync({
      id: agentSessionName,
      issueId,
      workspace: workspacePath,
      harness: effectiveHarness ?? 'claude-code',
      role: 'work',
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
    });

    try {
      yield* Effect.promise(() => spawnPanCommandDetached({
        agentSessionName,
        issueId,
        role: 'work',
        workspacePath,
        args,
        cwd: workspacePath,
      }));
    } catch (err: any) {
      return jsonResponse({
        success: false,
        error: `Agent dir wiped but spawn failed: ${err?.message ?? String(err)}`,
        wiped: wipeResult.removed,
      }, { status: 500 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.restart_fresh_spawn_requested_complete', {
      model: spawnModel,
      harness: effectiveHarness,
    }));

    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      spawn: true,
      agentId: id,
      issueId,
      removed: wipeResult.removed,
      spawnedModel: spawnModel,
      spawnedHarness: effectiveHarness,
      hint: 'Fresh work agent spawned. It will read .pan/continue.json and the branch state to continue.',
    });
  })),
);

// ─── Route: POST /api/agents/restart-all ──────────────────────────────────────
//
// Restart all running workspace agents using restartAgent() directly.
// Quick mode (no graceful delay) to avoid serializing 30s waits across N agents.

export const postAgentsRestartAllRoute = HttpRouter.add(
  'POST',
  '/api/agents/restart-all',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      try {
        const running = (await Effect.runPromise(listRunningAgents())).filter(a => a.tmuxActive);
        const results: { id: string; issueId: string; model: string; status: string }[] = [];

        for (const agent of running) {
          try {
            const result = await restartAgent(agent.id, { graceful: false });
            if (result.success) {
              results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: 'restarted' });
            } else {
              results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: `failed: ${result.error}` });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[agents] Failed to restart ${agent.id}:`, msg);
            results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: `failed: ${msg}` });
          }
        }

        const succeeded = results.filter(r => r.status === 'restarted').length;
        console.log(`[agents] Restarted ${succeeded}/${running.length} workspace agents`);
        return jsonResponse({ restarted: succeeded, total: running.length, results });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to restart agents: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/agents/:id/reset-session ─────────────────────────────
// Clears saved Claude session tracking so the next start creates a fresh session.
// Workspace, beads, and git state are preserved. JSONL files kept for cost history.

export const postAgentResetSessionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/reset-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const lifecycle = yield* getWorkAgentLifecycleState(id);
    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found`, lifecycle }, { status: 404 });
    }

    if (lifecycle.hasLiveTmuxSession) {
      return jsonResponse({ error: `Agent ${id} is running. Stop it first.`, lifecycle }, { status: 409 });
    }

    const previousSessionId = yield* getLatestSessionId(id);
    if (!previousSessionId) {
      return jsonResponse({ error: `Agent ${id} has no saved session to reset`, lifecycle }, { status: 404 });
    }

    const agentDir = getAgentDir(id);

    // Clear session.id
    yield* Effect.promise(() => rm(join(agentDir, 'session.id'), { force: true }));

    // Clear sessions.json
    yield* Effect.promise(() => rm(join(agentDir, 'sessions.json'), { force: true }));

    // Clear claudeSessionId from runtime.json (preserve other fields).
    // Must read/write directly — saveAgentRuntimeState merges with existing file.
    const runtimeFile = join(agentDir, 'runtime.json');
    if (existsSync(runtimeFile)) {
      try {
        const runtimeContent = yield* Effect.promise(() => readFile(runtimeFile, 'utf-8'));
        const runtime = JSON.parse(runtimeContent);
        delete runtime.claudeSessionId;
        yield* Effect.promise(() => writeFile(runtimeFile, JSON.stringify(runtime, null, 2)));
      } catch { /* non-fatal */ }
    }

    yield* killSession(id).pipe(Effect.catch(() => Effect.void));

    // Emit event so dashboard updates. PAN-1048 review feedback 004 (C1):
    // include issueId — without it AgentStoppedEvent fails Schema validation.
    //
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram(agentState, {
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, issueId: agentState.issueId },
    });

    console.log(`[reset-session] Cleared session for ${id} (was: ${previousSessionId.slice(0, 8)}...)`);
    invalidateAgentsCache();
    return jsonResponse({ success: true, agentId: id, previousSessionId, lifecycle: yield* getWorkAgentLifecycleState(id) });
  })),
);

// ─── Route: POST /api/agents/restart-with-current-config ────────────────────
// List all agents with their current vs new staffing, allowing operator to
// selectively restart with new config

export interface RestartConfigChangeItem {
  agentId: string;
  issueId: string;
  currentModel: string;
  currentHarness: string;
  newModel: string;
  newHarness: string;
  changed: boolean;
  paused: boolean;
  troubled: boolean;
  status: string;
}

async function buildRestartConfigChangeList(): Promise<RestartConfigChangeItem[]> {
  const agents = await Effect.runPromise(listRunningAgents());

  const items: RestartConfigChangeItem[] = [];

  for (const agent of agents) {
    if (!agent.issueId) continue;

    // Only include actually running agents with active tmux sessions
    if (!((agent as any).tmuxActive === true)) {
      continue;
    }

    // Skip paused/troubled agents (their gates stand)
    if ((agent as any).paused || (agent as any).troubled) {
      continue;
    }

    // Only work agents eligible for restart (skip conversations)
    if (agent.role !== 'work' && agent.role !== undefined) {
      continue;
    }

    // Compute new staffing from current config by reading the real vBRIEF work item
    const staffingResult = await resolveCurrentStaffing(agent.id, agent, agent.issueId);

    if (staffingResult.error) {
      // Skip agents where staffing cannot be resolved
      console.warn(`[restart-config] Skipping ${agent.id}: ${staffingResult.error}`);
      continue;
    }

    const newModel = staffingResult.newModel;
    const newHarness = staffingResult.newHarness;

    items.push({
      agentId: agent.id,
      issueId: agent.issueId,
      currentModel: agent.model,
      currentHarness: agent.harness ?? 'claude-code',
      newModel,
      newHarness,
      changed: agent.model !== newModel || (agent.harness ?? 'claude-code') !== newHarness,
      paused: (agent as any).paused ?? false,
      troubled: (agent as any).troubled ?? false,
      status: agent.status,
    });
  }

  return items;
}

export const getAgentsRestartConfigRoute = HttpRouter.add(
  'GET',
  '/api/agents/restart-with-current-config',
  httpHandler(Effect.gen(function* () {
    try {
      const items = yield* Effect.promise(() => buildRestartConfigChangeList());
      return jsonResponse({
        success: true,
        items,
        totalAgents: items.length,
        changedAgents: items.filter(i => i.changed).length,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: `Failed to build restart config list: ${msg}` }, { status: 500 });
    }
  })),
);

// ─── Route: POST /api/agents/restart-with-current-config ────────────────────
// Restart selected agents with current config

async function resolveCurrentStaffing(agentId: string, agentState: any, issueId: string): Promise<{ newModel: string; newHarness: string; error?: string }> {
  const workspacePath = agentState.workspace;
  if (!workspacePath) {
    return { newModel: agentState.model, newHarness: agentState.harness ?? 'claude-code', error: 'No workspace path available' };
  }

  try {
    // Read the actual vBRIEF plan
    const plan = readWorkspacePlanSync(workspacePath);
    if (!plan || !plan.plan.items) {
      return { newModel: agentState.model, newHarness: agentState.harness ?? 'claude-code', error: 'Invalid plan structure' };
    }

    // Find the work item using the same logic as spawn-prep:
    // For slot agents, use slotItemId; for single-work agents, use first dispatchable item
    let workItem = null;
    if (agentState.slotItemId) {
      // Slot agent: find the item by ID
      workItem = plan.plan.items.find((item: any) => item.id === agentState.slotItemId);
      if (!workItem) {
        return { newModel: agentState.model, newHarness: agentState.harness ?? 'claude-code', error: `Scheduled item ${agentState.slotItemId} not found in plan` };
      }
    } else {
      // Single-work agent: use first dispatchable item (same as spawn-prep)
      const dispatchableItems = getDispatchableItems(plan, new Set());
      workItem = dispatchableItems[0];
      if (!workItem) {
        return { newModel: agentState.model, newHarness: agentState.harness ?? 'claude-code', error: 'No dispatchable items in plan' };
      }
    }

    // Use the real work item with plan metadata for staffing resolution
    // This matches the logic in resolveSingleWorkTierSpawnParams
    const config = loadConfigSync().config;
    const tiered = config.tieredExecution;
    const effectiveTieredEnabled = issueId
      ? resolveTieredExecutionEnabledForIssue(tiered, issueId, plan.plan.metadata)
      : resolveTieredExecutionEnabled(tiered, plan.plan.metadata);

    const staffing = resolveStaffing(workItem, {
      planMetadata: plan.plan.metadata,
      spawnKey: `work:${issueId.toLowerCase()}`,
      config: { ...config, tieredExecution: { ...tiered, enabled: effectiveTieredEnabled } },
    });

    return {
      newModel: staffing.model,
      newHarness: staffing.harness,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      newModel: agentState.model,
      newHarness: agentState.harness ?? 'claude-code',
      error: `Failed to resolve staffing: ${msg}`,
    };
  }
}

export const postAgentsRestartWithConfigRoute = HttpRouter.add(
  'POST',
  '/api/agents/restart-with-current-config',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { agentIds } = body as { agentIds?: string[] };

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return jsonResponse({ error: 'agentIds array is required and must not be empty' }, { status: 400 });
    }

    // Get eligible agents from the same predicate as the GET route
    const eligibleAgents = yield* Effect.promise(() => buildRestartConfigChangeList());
    const eligibleIds = new Set(eligibleAgents.map(a => a.agentId));

    const results: { id: string; status: string; newModel?: string; newHarness?: string; error?: string }[] = [];

    for (const agentId of agentIds) {
      try {
        // Check if agent is in the eligible set
        if (!eligibleIds.has(agentId)) {
          results.push({ id: agentId, status: 'ineligible', error: 'Agent is not eligible for restart (paused, troubled, stopped, or not a work agent)' });
          continue;
        }

        const agentState = yield* getAgentState(agentId);
        if (!agentState) {
          results.push({ id: agentId, status: 'not_found', error: `Agent state not found` });
          continue;
        }

        const issueId = agentState.issueId ?? agentId.replace(/^agent-/, '').toUpperCase();

        // Resolve new staffing using the real work item
        const staffingResult = yield* Effect.promise(() => resolveCurrentStaffing(agentId, agentState, issueId));

        if (staffingResult.error) {
          results.push({
            id: agentId,
            status: 'staffing_error',
            error: staffingResult.error,
          });
          continue;
        }

        const newModel = staffingResult.newModel;
        const newHarness = staffingResult.newHarness;

        // Restart with new config
        const restartResult = yield* Effect.promise(() => restartAgent(agentId, {
          model: newModel,
          harness: newHarness as any,
          graceful: false,
        }));

        if (restartResult.success) {
          results.push({
            id: agentId,
            status: 'restarted',
            newModel,
            newHarness,
          });
        } else {
          results.push({
            id: agentId,
            status: 'failed',
            error: restartResult.error,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          id: agentId,
          status: 'error',
          error: msg,
        });
      }
    }

    const succeeded = results.filter(r => r.status === 'restarted').length;
    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      restarted: succeeded,
      total: agentIds.length,
      results,
    });
  })),
);
