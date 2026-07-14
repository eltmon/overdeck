import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  saveAgentStateSync,
  determineModel,
  getProviderAuthMode,
  getAgentState,
  clearAgentPaused,
  clearAgentTroubled,
  clearAgentPausedSync,
  clearAgentTroubledSync,
} from '../../../../lib/agents.js';
import { operatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { buildChildEnvWithoutTmuxSync } from '../../../../lib/child-env.js';
import { checkCodexAuthStatus } from '../../../../lib/codex-auth.js';
import { canUseHarnessSync } from '../../../../lib/harness-policy.js';
import { emitActivityEntrySync } from '../../../../lib/activity-logger.js';
import { appendOperatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../../lib/issue-id.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataFn } from '../../../../lib/remote/workspace-metadata.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { withBdMutex } from '../../../../lib/bd-mutex.js';
import { validateProviderHealth } from '../../../../lib/provider-health.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { isStateMigrated } from '../../../../lib/state-home.js';
import { shouldCommitLegacyWorkspaceArtifacts } from '../../../../lib/state-read-home.js';
import { getWorkspaceStackHealth } from '../../../../lib/workspace/stack-health.js';
import { writeAutoStartVBrief } from '../../../../lib/vbrief/auto-synthesize.js';
import { findPlan, readPlan } from '../../../../lib/vbrief/io.js';
import { transitionVBriefOnMain, updatePlanStatus } from '../../../../lib/vbrief/lifecycle-io.js';
import { jsonResponse } from '../../http-helpers.js';
import { ReadModelService } from '../../read-model.js';
import { EventStoreService } from '../../services/domain-services.js';
import { saveAgentStateAndEmitEventProgram } from '../../services/agent-projection.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { getSystemHealthSnapshot } from '../../services/system-health-service.js';
import { httpHandler } from '../http-handler.js';
import { validateOrigin } from '../origin-validation.js';
import { sessionExists, killSession } from '../../../../lib/tmux.js';
import {
  appendAgentLifecycleLog,
  buildHostOverrideConfirmation,
  buildPanStartArgs,
  emitStartAgentPhase,
  evaluateAgentStartGate,
  evaluateSpawnGuardrails,
  execAsync,
  execFileAsync,
  getIssueDataService,
  getProjectPath,
  invalidateAgentsCache,
  readJsonBody,
  spawnPanCommandDetached,
  updateRegistryForAgentStart,
  type AgentStartGateDecision,
} from './shared.js';
import {
  handleContainerOrchestration,
  handleRemoteAgentSpawn,
} from './spawn-helpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * PAN-2386: emit a dashboard activity event when start-agent refuses to spawn
 * because the workspace is dirty. Kept as a pure function so the refusal path
 * can be unit-tested without booting the full Effect route stack.
 */
export function emitDirtyWorkspaceRefusalActivity(issueId: string, porcelain: string): void {
  try {
    emitActivityEntrySync({
      source: 'dashboard',
      level: 'warn',
      message: `Workspace dirty — agent start refused for ${issueId}`,
      issueId,
      details: JSON.stringify({
        reason: 'Workspace has uncommitted changes. Commit, discard, or resolve and retry.',
        porcelain: porcelain.split('\n').slice(0, 5),
      }),
    });
  } catch { /* non-fatal — activity emit should not block the response */ }
}

export function spawnGuardrailResourcesHint(hint?: string): string {
  const resourcesHint = 'Open /resources to inspect Machine Room pressure before retrying.';
  return hint ? `${hint} ${resourcesHint}` : resourcesHint;
}

/**
 * Count materialized beads for an issue by shelling out to `bd list`.
 *
 * Returns 0 on ANY bd failure — non-zero exit (e.g. bd refusing with "Linear
 * data has never been pulled"), an unparseable JSON body, or the 10s timeout.
 * The caller treats 0 as "no beads yet" and falls through to auto-recovery
 * (createBeadsFromVBrief) and, failing that, a clean 422 `beads_required`.
 *
 * The failure is folded into the success channel with `Effect.matchCause`. A
 * bare `try/catch` around `yield* withBdMutex(...)` does NOT work: withBdMutex
 * converts the child-process rejection into an Effect error-channel failure
 * (via its internal `Effect.tryPromise`), which short-circuits the fiber and is
 * invisible to a JS `try/catch`. Before this helper, that escaped as an
 * unhandled 500 on POST /api/agents instead of the designed 422.
 */
export const countBeadsForIssue = (
  workspacePath: string,
  issueLower: string,
): Effect.Effect<number, never> =>
  withBdMutex(() => Effect.promise(() => execFileAsync(
    'bd',
    ['list', '--json', '-l', issueLower, '--status', 'all', '--limit', '0'],
    { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
  ))).pipe(
    Effect.matchCause({
      onFailure: () => 0,
      onSuccess: ({ stdout }) => {
        try {
          const bdTasks = JSON.parse(stdout.trim() || '[]');
          return Array.isArray(bdTasks) ? bdTasks.length : 0;
        } catch {
          return 0;
        }
      },
    }),
  );

// ─── Start-agent gate resolution (PAN-2499) ───────────────────────────────────

/**
 * Evaluate the persistent start gate for an agent and, if the request is
 * operator-origin and `clearGates` is set, clear the paused/troubled gates
 * through the same write paths used by `pan unpause` and `pan untroubled`.
 *
 * Returns the gate decision when the agent is still blocked, or `null` when
 * the agent may proceed. Emits `operator.intervention` events when a gate is
 * actually cleared.
 */
export function resolveStartAgentGateForRoute(input: {
  agentSessionName: string;
  issueId: string;
  clearGates: boolean;
  originOk: boolean;
}): Effect.Effect<AgentStartGateDecision | null, never> {
  let gate: AgentStartGateDecision | null = null;

  return Effect.gen(function* () {
    const state = yield* getAgentState(input.agentSessionName);
    gate = evaluateAgentStartGate(input.agentSessionName, state);
    if (!gate) return null;

    const shouldClear = input.originOk && input.clearGates;
    if (!shouldClear) return gate;
    if (!state) return gate;

    let cleared = false;
    if (state.paused === true) {
      yield* clearAgentPaused(input.agentSessionName);
      yield* Effect.promise(() =>
        appendOperatorInterventionEvent({
          issueId: input.issueId,
          kind: 'unpause',
          source: 'dashboard start-agent',
        }),
      );
      cleared = true;
    }

    if (state.troubled === true || (state.consecutiveFailures ?? 0) > 0) {
      yield* clearAgentTroubled(input.agentSessionName);
      yield* Effect.promise(() =>
        appendOperatorInterventionEvent({
          issueId: input.issueId,
          kind: 'untroubled',
          source: 'dashboard start-agent',
        }),
      );
      cleared = true;
    }

    if (!cleared) return gate;

    gate = evaluateAgentStartGate(input.agentSessionName, yield* getAgentState(input.agentSessionName));
    return gate;
  }).pipe(
    Effect.catch((err) => {
      console.error(`[start-agent] Failed to clear gates for ${input.issueId}: ${err instanceof Error ? err.message : String(err)}`);
      return Effect.succeed(gate);
    }),
  );
}

// ─── Route: POST /api/agents (start agent) ───────────────────────────────────

export const postAgentsRoute = HttpRouter.add(
  'POST',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;
    const readModel = yield* ReadModelService;

    const { issueId, projectId } = body as any;
    const autoStart = (body as any).auto === true;
    const guardrailAcknowledged = (body as any).guardrailAcknowledged === true;
    const requestedHostOverride = (body as any).host === true || (body as any).allowHost === true;

    if (!issueId) {
      return jsonResponse({ error: 'issueId required' }, { status: 400 });
    }

    const legacyFields = ['workType', 'phase', 'agentType'].filter((field) => field in (body as Record<string, unknown>));
    if (legacyFields.length > 0) {
      return jsonResponse({
        error: `Legacy start-agent field(s) are no longer accepted: ${legacyFields.join(', ')}. Send role: 'work' instead.`,
      }, { status: 400 });
    }

    const role = (body as any).role ?? 'work';
    if (role !== 'work') {
      return jsonResponse({ error: `Unsupported agent role "${String(role)}". POST /api/agents only starts role: 'work'.` }, { status: 400 });
    }

    // Reject bare numeric IDs (e.g. "484") — they have no project prefix, so tracker
    // routing and workspace naming both fail. Require "PAN-484" style.
    if (/^\d+$/.test(String(issueId))) {
      return jsonResponse(
        {
          error: `Invalid issueId "${issueId}": bare numeric IDs are not allowed. Use a prefixed ID (e.g. PAN-${issueId}).`,
          hint: 'Issue IDs must include a project prefix (e.g. PAN-484, MIN-123).',
        },
        { status: 422 },
      );
    }

    const parsedIssueId = parseIssueIdSync(String(issueId));
    if (!parsedIssueId) {
      return jsonResponse(
        {
          error: `Invalid issueId "${issueId}": issue IDs must use a supported project format (e.g. PAN-484, MIN-123).`,
          hint: 'Issue IDs must include a project prefix and numeric identifier.',
        },
        { status: 422 },
      );
    }

    const hostOverrideConfirmation = buildHostOverrideConfirmation(String(issueId));
    const allowHost = requestedHostOverride && (body as any).hostOverrideConfirmation === hostOverrideConfirmation;
    if (requestedHostOverride && !allowHost) {
      return jsonResponse({
        success: false,
        error: 'host_override_confirmation_required',
        requiresHostConfirmation: true,
        confirmation: hostOverrideConfirmation,
        hint: `Host override bypasses workspace isolation. Retry only after explicitly confirming: ${hostOverrideConfirmation}`,
      }, { status: 409 });
    }

    // Guard: reject starting agents for already-closed issues
    const issueDataService = getIssueDataService();
    const cachedIssues = issueDataService.getIssues();
    const cachedIssue = cachedIssues.find(
      (i: any) => (i.identifier || '').toUpperCase() === issueId.toUpperCase()
    );
    if (cachedIssue && (cachedIssue.canonicalStatus === 'done' || cachedIssue.canonicalStatus === 'canceled')) {
      return jsonResponse(
        {
          error: `Issue ${issueId} is already closed (${cachedIssue.canonicalStatus}). Cannot start an agent for a closed issue.`,
          hint: 'Reopen the issue first if you need to resume work.',
        },
        { status: 422 },
      );
    }

    const issueLower = parsedIssueId.normalized;
    const agentSessionName = `agent-${issueLower}`;
    const clearGates = originCheck.ok && (body as any).clearGates === true;
    const startGateBlock = yield* resolveStartAgentGateForRoute({
      agentSessionName,
      issueId,
      clearGates,
      originOk: originCheck.ok,
    });
    if (startGateBlock) {
      if (!clearGates) {
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked_gate', {
          issueId,
          paused: startGateBlock.paused,
          troubled: startGateBlock.troubled,
          reason: startGateBlock.error,
        }));
        return jsonResponse(startGateBlock, { status: 409 });
      }
      // clearGates:true — clear each reported gate through the shared doors and
      // emit the same operator-intervention events the CLI commands emit. Like the
      // sibling lifecycle-stop/lifecycle-restart routes, emit through the injected
      // eventStore (not the CLI's appendOperatorInterventionEvent global path) so
      // the event lands in the dashboard's Effect-provided EventStoreService.
      if (startGateBlock.paused) {
        clearAgentPausedSync(agentSessionName);
        yield* eventStore.appendAsync(operatorInterventionEvent({ issueId, kind: 'unpause', source: 'dashboard' }));
      }
      if (startGateBlock.troubled) {
        clearAgentTroubledSync(agentSessionName);
        yield* eventStore.appendAsync(operatorInterventionEvent({ issueId, kind: 'untroubled', source: 'dashboard' }));
      }
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_gates_cleared', {
        issueId,
        paused: startGateBlock.paused,
        troubled: startGateBlock.troubled,
      }));
      // The Sync doors just cleared the reported gates in state.json; re-read and
      // re-evaluate as a race guard (e.g. a concurrent re-pause). If a gate is
      // somehow still set, refuse with that reason rather than spawning.
      const recheckBlock = evaluateAgentStartGate(agentSessionName, yield* getAgentState(agentSessionName));
      if (recheckBlock) {
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked_gate', {
          issueId,
          paused: recheckBlock.paused,
          troubled: recheckBlock.troubled,
          reason: recheckBlock.error,
        }));
        return jsonResponse(recheckBlock, { status: 409 });
      }
    }

    const workspaceMetadata = loadWorkspaceMetadataFn(issueId);
    const isRemote = workspaceMetadata?.location === 'remote';

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const resolvedProject = resolveProjectFromIssueSync(String(issueId));
    const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
    const projectPath = projectConfig?.path ?? getProjectPath(projectId, issuePrefix);

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (!existsSync(workspacePath)) {
      try {
        const nodeDir = dirname(process.execPath);
        yield* Effect.promise(() => execAsync(
          `pan workspace create ${issueId} --local`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 60000, env: buildChildEnvWithoutTmuxSync(process.env, { PATH: `${nodeDir}:${process.env.PATH ?? ''}` }) }
        ));
      } catch (wsErr) {
        return jsonResponse({
          error: `Failed to create workspace for ${issueId}: ${(wsErr as Error).message}`,
          hint: 'Try creating the workspace manually: pan workspace create ' + issueId + ' --local',
        }, { status: 500 });
      }
    }

    const workspacePanDir = join(workspacePath, PAN_DIRNAME);
    const workspacePanContinuePath = join(workspacePanDir, PAN_CONTINUE_FILENAME);

    const workspaceBeadsDir = join(workspacePath, '.beads');
    if (!existsSync(workspaceBeadsDir)) {
      const projectRootBeadsDir = join(projectPath, '.beads');
      if (existsSync(projectRootBeadsDir)) {
        try {
          yield* Effect.promise(() => cp(projectRootBeadsDir, workspaceBeadsDir, { recursive: true }));
        } catch {}
      }
    }

    let planPath = yield* findPlan(workspacePath);
    if (autoStart && !planPath) {
      const issueTitle = cachedIssue?.title || issueId;
      const issueBody = cachedIssue?.description || '';
      // writeAutoStartVBrief is Effect-returning — yield it directly (PAN-1768).
      yield* writeAutoStartVBrief(projectPath, workspacePath, {
        issueId,
        title: issueTitle,
        body: issueBody,
        url: cachedIssue?.url,
      });
      planPath = yield* findPlan(workspacePath);
    }
    if (!planPath) {
      return jsonResponse({
        error: `No workspace vBRIEF found for ${issueId}. Work agents require a finalized plan with matching beads.`,
        hint: 'Run planning first, or use auto-start to synthesize a plan before starting the work agent.',
        issueId,
      }, { status: 422 });
    }

    const planReadResult = yield* readPlan(planPath).pipe(
      Effect.match({
        onFailure: (planErr) => ({ _tag: 'failure' as const, planErr }),
        onSuccess: (planDoc) => ({ _tag: 'success' as const, planDoc }),
      }),
    );
    if (planReadResult._tag === 'failure') {
      const { planErr } = planReadResult;
      return jsonResponse({
        error: `Could not read workspace vBRIEF for ${issueId}: ${planErr instanceof Error ? planErr.message : String(planErr)}`,
        hint: 'Re-run planning to produce a readable vBRIEF before starting the work agent.',
        issueId,
      }, { status: 422 });
    }
    const { planDoc } = planReadResult;

    const planIssueId = planDoc?.plan?.id;
    if (planIssueId && planIssueId.toLowerCase() !== issueLower) {
      return jsonResponse({
        error: `Plan in workspace is for ${planIssueId.toUpperCase()}, not ${issueId}. The workspace contains stale planning artifacts from a different issue.`,
        hint: 'Run planning for this issue first, or clean the workspace planning artifacts.',
        issueId,
        expectedIssue: issueId,
        actualIssue: planIssueId.toUpperCase(),
      }, { status: 422 });
    }

    const planItemCount = planDoc?.plan?.items?.length ?? 0;
    if (planItemCount === 0) {
      return jsonResponse({
        error: 'Plan exists but contains no items. Planning may have failed or produced an empty plan.',
        hint: 'Re-run planning to produce a plan with tasks and acceptance criteria.',
        issueId,
      }, { status: 422 });
    }

    // countBeadsForIssue swallows all bd failures into 0 — a bd error here (e.g.
    // "Linear data has never been pulled" exiting non-zero) must fall through to
    // auto-recovery + a clean 422, never escape as an unhandled 500.
    let beadCount = yield* countBeadsForIssue(workspacePath, issueLower);
    let hasBeads = beadCount > 0;
    if (planItemCount !== null && planItemCount > 0 && beadCount !== planItemCount) {
      hasBeads = false;
    }

    let recoveryError: string | null = null;
    if (!hasBeads) {
      // Auto-recovery: beads DB may not have been initialized (fresh install, or planning
      // completed before bd init ran). Attempt to create beads from the vBRIEF plan now.
      console.log(`[agents] No beads for ${issueId} — attempting auto-recovery via createBeadsFromVBrief`);
      try {
        const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../../lib/vbrief/beads.js'));
        const recovery = yield* createBeadsFromVBrief(workspacePath);
        beadCount = recovery.created.length;
        hasBeads = recovery.created.length > 0 && (planItemCount === null || recovery.created.length === planItemCount);
        if (hasBeads) {
          console.log(`[agents] Auto-recovery created ${recovery.created.length} beads for ${issueId}`);
        } else if (recovery.created.length > 0 && planItemCount !== null) {
          recoveryError = `created ${recovery.created.length} beads, but vBRIEF has ${planItemCount} plan items`;
        } else if (recovery.errors.length > 0) {
          recoveryError = recovery.errors[0] ?? 'Unknown error during beads creation';
          console.warn(`[agents] Auto-recovery errors: ${recovery.errors.join(', ')}`);
        } else {
          recoveryError = 'createBeadsFromVBrief returned no beads and no errors';
        }
      } catch (recoveryErr: any) {
        recoveryError = recoveryErr.message;
        console.warn(`[agents] Auto-recovery failed: ${recoveryErr.message}`);
      }
    }

    if (!hasBeads) {
      // PAN-1048 C6: Beads are a hard requirement for the work role — without
      // them the agent has nothing to claim, no Jidoka inspection scope, and
      // commits would batch across multiple beads. Recovery already attempted
      // above via createBeadsFromVBrief; if that failed the workspace's vBRIEF
      // is missing or malformed, which is a planning bug that must surface to
      // the operator. Refuse the spawn with 422 instead of starting a half-
      // configured work agent that will silently misbehave.
      const detail = recoveryError
        ? ` Beads recovery failed: ${recoveryError}.`
        : ' No beads exist for this issue.';
      console.warn(`[agents] Refusing to start work agent for ${issueId} without beads.${detail}`);
      return jsonResponse({
        success: false,
        error: 'beads_required',
        message: `Cannot start work agent for ${issueId} without beads.${detail} `
          + 'Re-run planning so beads can be materialized from the vBRIEF plan, then retry.',
        ...(recoveryError ? { recoveryError } : {}),
      }, { status: 422 });
    }

    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    emitStartAgentPhase(issueId, 'guardrails', 'start', 'evaluating spawn guardrails');
    const spawnGuardrails = evaluateSpawnGuardrails(health);
    if (spawnGuardrails.blocked) {
      emitStartAgentPhase(issueId, 'guardrails', 'failure', spawnGuardrails.error ?? 'guardrails blocked', {
        status: spawnGuardrails.status,
        hint: spawnGuardrails.hint,
      });
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: spawnGuardrails.error,
        hint: spawnGuardrails.hint,
        guardrails: spawnGuardrails,
      }, { status: spawnGuardrails.status });
    }
    if (spawnGuardrails.requiresAcknowledgement && !guardrailAcknowledged) {
      emitStartAgentPhase(issueId, 'guardrails', 'skipped', 'guardrail acknowledgement required', {
        status: spawnGuardrails.status,
        hint: spawnGuardrails.hint,
      });
      return jsonResponse({
        success: false,
        blocked: false,
        skipped: true,
        requiresAcknowledgement: true,
        hint: spawnGuardrailResourcesHint(spawnGuardrails.hint),
        guardrails: spawnGuardrails,
      }, { status: spawnGuardrails.status });
    }
    emitStartAgentPhase(issueId, 'guardrails', 'success', 'spawn guardrails passed');

    let spawnModel: string;
    try {
      spawnModel = determineModel({
        model: (body as any).model,
        role,
        spawnKey: `${role}:${issueId}`,
      });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    const providerAuthMode = yield* Effect.promise(() => getProviderAuthMode(spawnModel));
    if (providerAuthMode === 'subscription') {
      const codexAuth = yield* checkCodexAuthStatus();
      if (codexAuth.status === 'expired' || codexAuth.status === 'burned') {
        return jsonResponse({
          success: false,
          blocked: true,
          skipped: true,
          error: `Codex authentication ${codexAuth.status}. GPT subscription agents cannot spawn with expired/burned tokens.`,
          hint: 'Click "Re-authenticate" in the Codex auth banner or Settings page to refresh your OpenAI subscription tokens.',
        }, { status: 429 });
      }
    }

    // Pre-flight provider health check — detect quota/auth/network errors
    // before spawning the agent into Claude Code's opaque retry loop.
    // validateProviderHealth returns an Effect (typed ProviderHealthError
    // channel) — wrapping it in Effect.promise handed a non-thenable to the
    // runtime and crashed the whole request (PAN-1768).
    const providerHealthCheck = yield* validateProviderHealth(spawnModel).pipe(
      Effect.match({
        onFailure: (err) => ({ _tag: 'failure' as const, err }),
        onSuccess: () => ({ _tag: 'success' as const, err: null }),
      }),
    );
    if (providerHealthCheck._tag === 'failure' && providerHealthCheck.err) {
      const err = providerHealthCheck.err;
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: err.message,
        hint: err.probeResult.kind === 'quota'
          ? 'Top up your credits on the provider dashboard, or switch this agent to a different model.'
          : err.probeResult.kind === 'auth'
            ? 'Check your API key in Settings → Providers.'
            : 'The provider may be temporarily unavailable. Try again later or switch models.',
        providerHealth: {
          provider: err.provider.name,
          model: err.model,
          kind: err.probeResult.kind,
          status: err.probeResult.status,
        },
      }, { status: 429 });
    }

    if (!isRemote) {
      emitStartAgentPhase(issueId, 'stackHealthGate', 'start', 'checking workspace docker stack health', { workspacePath });
      const stackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
      if (!stackHealth.healthy) {
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked_stack_unhealthy', {
          issueId,
          reasons: stackHealth.reasons,
          lastObserved: stackHealth.lastObserved,
        }));
        if (!allowHost) {
          emitStartAgentPhase(issueId, 'stackHealthGate', 'failure', stackHealth.reasons.join('; '), {
            workspacePath,
            lastObserved: stackHealth.lastObserved,
          });
          emitActivityEntrySync({
            source: 'dashboard',
            level: 'error',
            issueId: issueId.toUpperCase(),
            message: `agent-spawn-blocked-stack-unhealthy: ${issueId.toUpperCase()}`,
            details: stackHealth.reasons.join('; '),
          });
          return jsonResponse({
            success: false,
            blocked: true,
            skipped: true,
            error: `Workspace docker stack for ${issueId} is not healthy: ${stackHealth.reasons.join('; ')}`,
            hint: `Run 'pan workspace rebuild ${issueId}' or use the CLI break-glass path: pan start ${issueId} --host.`,
            stackHealth,
          }, { status: 422 });
        }
        emitStartAgentPhase(issueId, 'stackHealthGate', 'skipped', 'stack unhealthy but host override confirmed', {
          workspacePath,
          reasons: stackHealth.reasons,
        });
      } else {
        emitStartAgentPhase(issueId, 'stackHealthGate', 'success', 'workspace docker stack healthy', { workspacePath });
      }
    } else {
      emitStartAgentPhase(issueId, 'stackHealthGate', 'skipped', 'remote workspace skips local stack-health gate', { workspacePath });
    }

    if (allowHost) {
      // PAN-1556: host-override is a spawn detail, not user-facing activity.
      console.warn(`[agents] agent-spawn-host-override: ${issueId.toUpperCase()} (dashboard-confirmed)`);
    }

    const migratedState = projectConfig ? yield* Effect.promise(() => isStateMigrated(projectConfig)) : false;
    if (shouldCommitLegacyWorkspaceArtifacts(migratedState) && (existsSync(workspacePanContinuePath) || existsSync(workspacePanDir))) {
      // Commit workspace orchestration artifacts before handing off to the work agent.
      // The entire block is best-effort — never let git errors abort the agent start.
      yield* Effect.gen(function* () {
        const gitRoot = workspacePath;
        if (existsSync(join(gitRoot, PAN_DIRNAME))) {
          // PAN-1819: use plain git add (never -f) and exclude workspace-state/sync-target paths.
          yield* Effect.promise(() => execAsync(`git add .pan/`, { cwd: gitRoot, encoding: 'utf-8' }));
          yield* Effect.promise(() => execAsync(
            `git reset HEAD -- .pan/kickoff.md .pan/continue.json .pan/handoff-*.md .pan/spec.vbrief.json`,
            { cwd: gitRoot, encoding: 'utf-8' },
          ));
        }
        if (existsSync(join(gitRoot, '.beads'))) {
          yield* Effect.promise(() => execAsync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' }));
        }
        // git diff --cached --quiet exits 1 when there ARE staged changes (normal).
        // Handle exit-1 in the Promise so it never becomes an Effect failure.
        const diffResult = yield* Effect.promise(() =>
          execAsync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' })
            .then(() => false)
            .catch(() => true)
        );
        if (diffResult) {
          yield* Effect.promise(() => execAsync(`git commit -m "chore: planning artifacts for ${issueId} before agent start"`, { cwd: gitRoot, encoding: 'utf-8' }));
          const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
          pushChild.unref();
        }
      }).pipe(Effect.catch(() => Effect.void));
    }

    // Approval transition (PAN-946): move the scope vBRIEF on main from
    // proposed/ → active/ and stamp plan.status='approved'. Idempotent: if the
    // vBRIEF is already in active/ with status approved, this is a no-op. The
    // commit only happens when projectPath is on main; otherwise the on-disk
    // move still applies and a later sync will pick it up. Failure is non-fatal
    // — agent spawn proceeds even if the lifecycle move fails.
    // transitionVBriefOnMain is Effect-returning — match on it directly (PAN-1768).
    yield* transitionVBriefOnMain(
      projectPath,
      issueId,
      'active',
      'approved',
      `scope: approve ${issueId.toUpperCase()} vBRIEF`,
    ).pipe(
      Effect.match({
        onSuccess: (result) => {
          if (result.moved) {
            console.log(`[start-agent] vBRIEF moved ${result.fromDir} → active for ${issueId}`);
          }
          if (result.committed) {
            console.log(`[start-agent] Committed approval transition on main for ${issueId}`);
          }
        },
        onFailure: (err) => {
          console.warn(`[start-agent] vBRIEF approval transition failed (non-fatal): ${err?.message ?? err}`);
        },
      }),
    );

    // Running transition (PAN-946): set workspace plan.status to 'running'.
    // This is the worktree-side state — the workspace vBRIEF resolved by
    // findPlan() is updated directly, and the planning artifacts commit below
    // will pick it up. Non-fatal: agent starts even if the write fails.
    if (existsSync(planPath)) {
      try {
        updatePlanStatus(planPath, 'running');
        console.log(`[start-agent] Set plan.status=running for ${issueId}`);
      } catch (planStatusErr: any) {
        console.warn(`[start-agent] Failed to set plan.status=running (non-fatal): ${planStatusErr?.message ?? planStatusErr}`);
      }
    }

    // Write start session entry to per-issue record (PAN-1919)
    try {
      const { appendSessionEntry, getProjectConfigFromWorkspacePath, resolveProjectForIssue } =
        yield* Effect.promise(() => import('../../../../lib/pan-dir/record.js'));
      const recordProject = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
      yield* Effect.promise(() => appendSessionEntry(recordProject, issueId, {
        timestamp: new Date().toISOString(),
        reason: 'start',
        agentModel: spawnModel,
      }));
      console.log(`[start-agent] Wrote start session entry to record for ${issueId}`);
    } catch (continueErr: any) {
      console.warn(`[start-agent] Failed to write start entry to record (non-fatal): ${continueErr?.message ?? continueErr}`);
    }

    if (isRemote && workspaceMetadata) {
      return yield* handleRemoteAgentSpawn({
        issueId,
        workspacePath,
        workspaceMetadata,
        spawnModel,
        projectPath,
        spawnGuardrails,
        lifecycle,
      });
    }

    // Local workspace
    const devScript = join(workspacePath, 'dev');
    const hasPlanning = existsSync(join(workspacePath, PAN_DIRNAME));

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_requested', {
      issueId,
      workspacePath,
      hasPlanning,
      role,
    }));

    const agentLifecycle = yield* getWorkAgentLifecycleState(agentSessionName);
    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_lifecycle_evaluated', {
      issueId,
      lifecycle: agentLifecycle,
    }));
    if (!agentLifecycle.canStartFresh) {
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked', {
        issueId,
        reason: agentLifecycle.reason,
        lifecycle: agentLifecycle,
      }));
      return jsonResponse({
        error: agentLifecycle.reason || `Cannot start agent for ${issueId}`,
        lifecycle: agentLifecycle,
      }, { status: 409 });
    }

    yield* Effect.gen(function* () {
      const exists = yield* sessionExists(agentSessionName);
      if (exists) yield* killSession(agentSessionName);
      console.log(`[start-agent] Killed stale tmux session ${agentSessionName}`);
    }).pipe(Effect.catch(() => Effect.void));

    // PAN-1531: dirty-worktree refusal replaces silent pre-spawn stashing.
    // If the workspace has uncommitted changes the route returns 409 with the
    // diff so the dashboard can present the user three explicit choices:
    // Commit / Discard (typed confirmation required) / Stash as salvageable.
    // Clients that have already resolved the dirtiness MUST pass
    // `acknowledgeDirtyWorkspace: true` to bypass this gate (typically after
    // the user clicked one of the three modal buttons).
    const acknowledgeDirtyWorkspace = (body as any).acknowledgeDirtyWorkspace === true;
    if (!acknowledgeDirtyWorkspace) {
      try {
        const { stdout: statusOut } = yield* Effect.promise(() => execAsync('git status --porcelain', {
          cwd: workspacePath,
          encoding: 'utf-8',
        }));
        if (statusOut.trim()) {
          const { stdout: diffOut } = yield* Effect.promise(() => execAsync('git diff HEAD --stat', {
            cwd: workspacePath,
            encoding: 'utf-8',
          }).catch(() => ({ stdout: '' })));
          yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_refused_dirty_workspace', {
            issueId,
            workspacePath,
            porcelain: statusOut.trim(),
          }));
          // PAN-2386: surface the refusal in the dashboard activity feed so the operator
          // sees a toast instead of having to dig through lifecycle.log.
          emitDirtyWorkspaceRefusalActivity(issueId, statusOut.trim());
          return jsonResponse({
            error: `Workspace ${workspacePath} has uncommitted changes. Choose an action and retry start with acknowledgeDirtyWorkspace=true.`,
            code: 'WORKSPACE_DIRTY',
            workspacePath,
            porcelain: statusOut.trim(),
            diffStat: diffOut.trim(),
            actions: ['commit', 'discard', 'stash-salvage'],
          }, { status: 409 });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[start-agent] Failed to check workspace status for ${issueId}: ${message}`);
      }
    }

    // PAN-1048 review feedback 003: the route only resolves harness when the
    // dashboard launch panel explicitly chose one. Otherwise pass nothing and
    // let pan start → spawnAgent resolve from roles.work.harness (the new
    // single source of truth for per-role harness). The legacy `phase`
    // variable and the workType/harnessOverrides map are gone — the
    // legacy-field guard above (line 1872) blocks any client still sending
    // them. Note: when bodyHarness is set we still run it through
    // canUseHarness() so we can fail fast on a model+harness incompatibility
    // before spawning the subprocess.
    const bodyHarness = (body as any).harness;
    const userPickedHarness: 'claude-code' | 'ohmypi' | 'codex' | null =
      bodyHarness === 'ohmypi' || bodyHarness === 'claude-code' || bodyHarness === 'codex' ? bodyHarness : null;
    let effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | null = null;
    if (userPickedHarness !== null) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarnessSync(userPickedHarness, spawnModel, await getProviderAuthMode(spawnModel))
      );
      effectiveHarness = harnessDecision.allowed ? userPickedHarness : 'claude-code';
    }

    // Spawn pan start command
    const spawnPanCommand = async (args: string[], cwd?: string): Promise<string> => spawnPanCommandDetached({
      agentSessionName,
      issueId,
      role,
      workspacePath,
      args,
      cwd,
    });

    // Use IssueLifecycle service to transition issue to "In Progress" (PAN-449)
    const updateIssueStatus = async () => {
      await Effect.runPromise(
        lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
      );
    };

    const containerResponse = yield* handleContainerOrchestration({
      issueId,
      workspacePath,
      devScript,
      agentSessionName,
      role,
      effectiveHarness,
      allowHost,
      spawnModel,
      spawnGuardrails,
      projectPath,
      eventStore,
      spawnPanCommand,
      updateIssueStatus,
    });
    if (containerResponse) return containerResponse;

    // Containers already ready or no containers needed
    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_requested', {
      issueId,
      role,
      workspacePath,
    }));
    let activityId: string;
    try {
      emitStartAgentPhase(issueId, 'spawn', 'start', 'starting local work agent', { workspacePath });
      activityId = yield* Effect.promise(() => spawnPanCommand(
        buildPanStartArgs({
          issueId,
          model: spawnModel,
          harness: effectiveHarness,
          allowHost,
        }),
        workspacePath,
      ));
      emitStartAgentPhase(issueId, 'spawn', 'success', 'local work agent spawn requested', {
        workspacePath,
        activityId,
      });
    } catch (error: any) {
      const output = String(error?.output ?? error?.message ?? '');
      if (output.includes(`Workspace docker stack for ${issueId}`) && output.includes('is not healthy')) {
        const failedStackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
        emitStartAgentPhase(issueId, 'stackHealthGate', 'failure', failedStackHealth.reasons.length > 0 ? failedStackHealth.reasons.join('; ') : output.trim(), {
          workspacePath,
          activityId: error?.activityId,
        });
        emitStartAgentPhase(issueId, 'spawn', 'failure', output.trim() || `Failed to start agent for ${issueId}`, {
          workspacePath,
          activityId: error?.activityId,
        });
        emitActivityEntrySync({
          source: 'dashboard',
          level: 'error',
          issueId: issueId.toUpperCase(),
          message: `agent-spawn-blocked-stack-unhealthy: ${issueId.toUpperCase()}`,
          details: failedStackHealth.reasons.length > 0 ? failedStackHealth.reasons.join('; ') : output.trim(),
        });
        return jsonResponse({
          success: false,
          blocked: true,
          skipped: true,
          error: failedStackHealth.reasons.length > 0
            ? `Workspace docker stack for ${issueId} is not healthy: ${failedStackHealth.reasons.join('; ')}`
            : output.trim(),
          hint: `Run 'pan workspace rebuild ${issueId}' or use the CLI break-glass path: pan start ${issueId} --host.`,
          stackHealth: failedStackHealth,
          activityId: error?.activityId,
        }, { status: 422 });
      }
      emitStartAgentPhase(issueId, 'spawn', 'failure', output.trim() || `Failed to start agent for ${issueId}`, {
        workspacePath,
        activityId: error?.activityId,
      });
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: output.trim() || `Failed to start agent for ${issueId}`,
        activityId: error?.activityId,
      }, { status: 500 });
    }

    // Write early state.json so the dashboard immediately shows agent-<id> as the
    // active agent. Without this there's a race window between spawnPanCommand returning
    // and pan start calling saveAgentState(), during which the workspace detail
    // panel shows the stale planning-<id> session and "No saved output available."
    const earlyAgentId = agentSessionName; // e.g. "agent-pan-488"
    const earlyStateDir = join(homedir(), '.overdeck', 'agents', earlyAgentId);
    yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
    // PAN-1048 R2: legacy `runtime` removed; PAN-1055: persist user-picked harness.
    saveAgentStateSync({
      id: earlyAgentId,
      issueId,
      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
      workspace: workspacePath,
      role,
      hostOverride: allowHost || undefined,
    });
    updateRegistryForAgentStart(issueId, workspacePath, earlyAgentId);
    yield* Effect.promise(() => appendAgentLifecycleLog(earlyAgentId, 'agent.start_placeholder_created', {
      issueId,
      role,
      workspacePath,
      activityId,
    }));

    yield* Effect.promise(() => updateIssueStatus());

    // PAN-1048: lifecycle.transitionTo() inside updateIssueStatus() is the
    // single source of issue.transitioned. The duplicate issue.statusChanged
    // emit raced with reactive Cloister: the early state.json above (with
    // role: 'work', status: 'starting') is already on disk, so any code path
    // that wants to know about the in-flight spawn can read it. Removing the
    // redundant emit collapses two-source-of-truth into one.
    //
    // PAN-1048 review feedback 003: emit a contract-compliant agent.started
    // payload (agentId = session name, agent = AgentSnapshot) so the read-model
    // reducer writes a real snapshot into agentsById instead of `undefined`.
    // Mirrors the early state.json shape we just wrote at line 2693.
    //
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram({
      id: earlyAgentId,
      issueId,
      workspace: workspacePath,
      role,
      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
      hostOverride: allowHost || undefined,
    }, {
      type: 'agent.started',
      timestamp: new Date().toISOString(),
      payload: {
        agentId: earlyAgentId,
        issueId,
        agent: {
          id: earlyAgentId,
          issueId,
          workspace: workspacePath,
          status: 'starting',
          startedAt: new Date().toISOString(),
          role,
          ...(effectiveHarness ? { runtime: effectiveHarness } : {}),
        },
      },
    });
    try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      message: `Starting agent for ${issueId}`,
      activityId,
      projectPath,
      guardrails: spawnGuardrails,
    });
  })),
);
