import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { Cause, Effect, Exit } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  saveAgentState, determineModel, getProviderAuthMode, getAgentState,
  clearAgentPaused, clearAgentTroubled,
} from '../../../../lib/agents.js';
import { readAutoSpawnConsentWorkModel } from '../../../../lib/planning/auto-spawn-consent.js';
import type { AgentState } from '../../../../lib/agents/agent-state.js';
import { operatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { buildChildEnvWithoutTmux } from '../../../../lib/child-env.js';
import { CodexAuthCheckError, checkCodexAuthStatus } from '../../../../lib/codex-auth.js';
import { canUseHarness } from '../../../../lib/harness-policy.js';
import { emitActivityEntry } from '../../../../lib/activity-logger.js';
import { FsError } from '../../../../lib/errors.js';
import { appendOperatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { extractPrefix, parseIssueId } from '../../../../lib/issue-id.js';
import { workspaceNeedsSetup } from '../../../../lib/workspace-manager/setup-marker.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { loadWorkspaceMetadata as loadWorkspaceMetadataFn } from '../../../../lib/remote/workspace-metadata.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { ProviderHealthError, validateProviderHealth } from '../../../../lib/provider-health.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { isGeneratedGitHookPath, isOverdeckWorkspaceRuntimePath, parsePorcelainStatusPaths } from '../../../../lib/state-plane.js';
import { assertWorkspaceStackHealthyForSpawn } from '../../../../lib/agents/spawn-prep.js';
import { getWorkspaceStackHealth } from '../../../../lib/workspace/stack-health.js';
import { writeAutoStartXBrief } from '../../../../lib/xbrief/auto-synthesize.js';
import { findPlan, readPlan } from '../../../../lib/xbrief/io.js';
import { transitionXBriefOnMain, updatePlanStatus } from '../../../../lib/xbrief/lifecycle-io.js';
import { jsonResponse } from '../../http-helpers.js';
import { ReadModelService } from '../../read-model.js';
import { EventStoreService } from '../../services/domain-services.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { getSystemHealthSnapshot, type SystemHealthSnapshot } from '../../services/system-health-service.js';
import { httpHandler } from '../http-handler.js';
import { rejectUnsafeDashboardMutationRequest } from '../dashboard-auth.js';
import { sessionExists, killSession } from '../../../../lib/tmux.js';
import {
  appendAgentLifecycleLog,
  buildHostOverrideConfirmation,
  buildPanStartArgs,
  emitStartAgentPhase,
  evaluateAgentStartGate,
  evaluateSpawnGuardrails,
  execAsync,
  parseSpawnGuardrailAcknowledgement,
  unacknowledgedSpawnGuardrailWarnings,
  type SpawnGuardrailAcknowledgement,
  type SpawnGuardrailDecision,
  getIssueDataService,
  getProjectPath,
  invalidateAgentsCache,
  isInternalAgentRequest,
  readJsonBody,
  resolveRequestedStartedBy,
  resolveWorkSpawnRequestedModel,
  spawnPanCommandDetached,
  updateRegistryForAgentStart,
  type AgentStartGateDecision,
} from './shared.js';
import { claimAgentStart, handleContainerOrchestration, handleRemoteAgentSpawn, releaseAgentStart } from './spawn-helpers.js';
// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * PAN-2386: emit a dashboard activity event when start-agent refuses to spawn
 * because the workspace is dirty. Kept as a pure function so the refusal path
 * can be unit-tested without booting the full Effect route stack.
 */
export function emitDirtyWorkspaceRefusalActivity(issueId: string, porcelain: string): void {
  try {
    emitActivityEntry({
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

/**
 * True when git porcelain contains only Overdeck-owned workspace runtime files
 * (PAN-3042; shared predicate since PAN-3245) or generated git-hook output — the
 * `.husky/_/pre-rebase` guard that worktree creation writes made every fresh
 * workspace read as dirty and 409 the planning auto-handoff (PAN-3266).
 */
export function isOnlyOverdeckRuntimeWorkspaceChanges(porcelain: string): boolean {
  return parsePorcelainStatusPaths(porcelain)
    .every((path) => isOverdeckWorkspaceRuntimePath(path) || isGeneratedGitHookPath(path));
}

export function spawnGuardrailResourcesHint(hint?: string): string {
  const resourcesHint = 'Open /resources to inspect Machine Room pressure before retrying.';
  return hint ? `${hint} ${resourcesHint}` : resourcesHint;
}

/**
 * The guardrail step of POST /api/agents. Returns the guardrail decision and
 * the refusal response, which is null when the start may proceed. Critical warnings always refuse. A warning
 * refuses with 409 unless the request acknowledged its kind (PAN-3977).
 */
export function resolveSpawnGuardrailRefusal(
  issueId: string,
  health: SystemHealthSnapshot,
  acknowledgement: SpawnGuardrailAcknowledgement,
): { decision: SpawnGuardrailDecision; refusal: { status: number; body: Record<string, unknown> } | null } {
  emitStartAgentPhase(issueId, 'guardrails', 'start', 'evaluating spawn guardrails');
  const spawnGuardrails = evaluateSpawnGuardrails(health);
  if (spawnGuardrails.blocked) {
    emitStartAgentPhase(issueId, 'guardrails', 'failure', spawnGuardrails.error ?? 'guardrails blocked', {
      status: spawnGuardrails.status,
      hint: spawnGuardrails.hint,
    });
    return {
      decision: spawnGuardrails,
      refusal: {
        status: spawnGuardrails.status,
        body: {
          success: false,
          blocked: true,
          skipped: true,
          error: spawnGuardrails.error,
          hint: spawnGuardrails.hint,
          guardrails: spawnGuardrails,
        },
      },
    };
  }
  const unacknowledged = spawnGuardrails.requiresAcknowledgement
    ? unacknowledgedSpawnGuardrailWarnings(spawnGuardrails, acknowledgement)
    : [];
  if (unacknowledged.length > 0) {
    emitStartAgentPhase(issueId, 'guardrails', 'skipped', 'guardrail acknowledgement required', {
      status: spawnGuardrails.status,
      hint: spawnGuardrails.hint,
    });
    return {
      decision: spawnGuardrails,
      refusal: {
        status: spawnGuardrails.status,
        body: {
          success: false,
          blocked: false,
          skipped: true,
          requiresAcknowledgement: true,
          error: `Guardrail acknowledgement required: ${unacknowledged.map((warning) => warning.message).join(' ')}`,
          hint: spawnGuardrailResourcesHint(spawnGuardrails.hint),
          guardrails: spawnGuardrails,
          unacknowledgedWarnings: unacknowledged,
        },
      },
    };
  }
  emitStartAgentPhase(issueId, 'guardrails', 'success', 'spawn guardrails passed');
  return { decision: spawnGuardrails, refusal: null };
}

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
    const state = yield* Effect.try({
      try: () => getAgentState(input.agentSessionName),
      catch: (cause) => new FsError({ operation: 'read', path: `agents-db:${input.agentSessionName}`, cause }),
    });
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

    gate = evaluateAgentStartGate(input.agentSessionName, yield* Effect.try({
      try: () => getAgentState(input.agentSessionName),
      catch: (cause) => new FsError({ operation: 'read', path: `agents-db:${input.agentSessionName}`, cause }),
    }));
    return gate;
  }).pipe(
    Effect.catch((err) => {
      console.error(`[start-agent] Failed to clear gates for ${input.issueId}: ${err instanceof Error ? err.message : String(err)}`);
      return Effect.succeed(gate);
    }),
  );
}

/**
 * Clear the persistent start gates immediately before spawning, restoring the
 * complete original state if either clear or the spawn itself fails.
 */
export async function spawnAfterClearingStartGates<T>(input: {
  agentSessionName: string;
  gate: AgentStartGateDecision | null;
  initialState: AgentState | null;
  spawn: () => Promise<T>;
  isSuccessful?: (result: T) => boolean;
}): Promise<T> {
  try {
    if (input.gate?.paused) await Effect.runPromise(clearAgentPaused(input.agentSessionName));
    if (input.gate?.troubled) await Effect.runPromise(clearAgentTroubled(input.agentSessionName));
    const result = await input.spawn();
    if (input.isSuccessful && !input.isSuccessful(result) && input.gate && input.initialState) {
      await Effect.runPromise(saveAgentState(input.initialState));
    }
    return result;
  } catch (error) {
    if (input.gate && input.initialState) {
      await Effect.runPromise(saveAgentState(input.initialState));
    }
    throw error;
  }
}
// ─── Route: POST /api/agents (start agent) ───────────────────────────────────

export const postAgentsRoute = HttpRouter.add(
  'POST',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;
    const readModel = yield* ReadModelService;
    const { issueId, projectId } = body as any;
    const internalRequest = yield* Effect.promise(() => isInternalAgentRequest(request));
    let startedBy: string;
    try { startedBy = resolveRequestedStartedBy((body as any).startedBy, internalRequest); }
    catch (error) { return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
    const autoStart = (body as any).auto === true;
    const autoSpawnConsentRequired = internalRequest && (body as any).autoSpawnConsentRequired === true;
    const guardrailAcknowledgement = parseSpawnGuardrailAcknowledgement(body);
    const offBook = (body as any).offBook === true;
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

    const parsedIssueId = parseIssueId(String(issueId));
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
    const clearGates = (body as any).clearGates === true;
    const initialAgentState = getAgentState(agentSessionName);
    const startGateBlock = evaluateAgentStartGate(agentSessionName, initialAgentState);
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
    }

    const workspaceMetadata = loadWorkspaceMetadataFn(issueId);
    const isRemote = workspaceMetadata?.location === 'remote';

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const resolvedProject = resolveProjectFromIssueSync(String(issueId));
    const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
    const projectPath = projectConfig?.path ?? getProjectPath(projectId, issuePrefix);
    // PAN-3917 D12: the order-book dispatch gate is gone. There is no flywheel
    // RUN to bind a book to — the flywheel skill decides what to start from the
    // order books under .pan, so a spawn request is simply honoured.

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    // PAN-4171: `pan workspace create` also resumes an unfinished setup.
    if (workspaceNeedsSetup(workspacePath)) {
      try {
        const nodeDir = dirname(process.execPath);
        yield* Effect.promise(() => execAsync(
          `pan workspace create ${issueId} --local`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 60000, env: buildChildEnvWithoutTmux(process.env, { PATH: `${nodeDir}:${process.env.PATH ?? ''}` }) }
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

    let planPath = yield* findPlan(workspacePath);
    if (autoStart && !planPath) {
      const issueTitle = cachedIssue?.title || issueId;
      const issueBody = cachedIssue?.description || '';
      // writeAutoStartXBrief is Effect-returning — yield it directly (PAN-1768).
      yield* writeAutoStartXBrief(projectPath, workspacePath, {
        issueId,
        title: issueTitle,
        body: issueBody,
        url: cachedIssue?.url,
      });
      planPath = yield* findPlan(workspacePath);
    }
    if (!planPath) {
      return jsonResponse({
        error: `No workspace xBRIEF found for ${issueId}. Work agents require a finalized plan.`,
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
        error: `Could not read workspace xBRIEF for ${issueId}: ${planErr instanceof Error ? planErr.message : String(planErr)}`,
        hint: 'Re-run planning to produce a readable xBRIEF before starting the work agent.',
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

    const health = yield* Effect.promise(() => getSystemHealthSnapshot());
    const { decision: spawnGuardrails, refusal: guardrailRefusal } = resolveSpawnGuardrailRefusal(issueId, health, guardrailAcknowledgement);
    if (guardrailRefusal) return jsonResponse(guardrailRefusal.body, { status: guardrailRefusal.status });

    // PAN-3022: a consent-bearing spawn with no explicit body model honors the
    // work model carried on the planning cycle's auto-start consent (the
    // operator's `pan start --model` at planning time) before the role
    // default. readAutoSpawnConsentWorkModel's own promise never rejects, but
    // .catch keeps this lookup fail-open regardless.
    const consentWorkModel = autoSpawnConsentRequired && !(body as any).model
      ? yield* Effect.promise(() => readAutoSpawnConsentWorkModel(issueId).catch(() => undefined))
      : undefined;
    const requestedModel = resolveWorkSpawnRequestedModel((body as any).model, consentWorkModel);

    let spawnModel: string;
    try {
      spawnModel = determineModel({
        model: requestedModel,
        role,
        spawnKey: `${role}:${issueId}`,
      });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    // PAN-3857: forward --model to `pan start` only for an explicit/consent model —
    // forwarding a resolved default would skip tier resolution and stamp record.workModel.
    const explicitModel: string | null = requestedModel ? spawnModel : null;
    const providerAuthMode = yield* Effect.promise(() => getProviderAuthMode(spawnModel));
    if (providerAuthMode === 'subscription') {
      const codexAuth = yield* Effect.tryPromise({
        try: () => checkCodexAuthStatus(),
        catch: (cause) => new CodexAuthCheckError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
      });
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
    // validateProviderHealth rejects only with ProviderHealthError (any other
    // throw is re-wrapped), so every failure lands in the blocked branch below.
    const providerHealthCheck = yield* Effect.tryPromise({
      try: () => validateProviderHealth(spawnModel),
      catch: (cause) => cause as ProviderHealthError,
    }).pipe(
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
      let stackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
      if (!stackHealth.healthy && !allowHost) {
        emitStartAgentPhase(issueId, 'stackHealthGate', 'start', 'stack unhealthy — attempting workspace stack rebuild', { workspacePath });
        yield* Effect.promise(() =>
          assertWorkspaceStackHealthyForSpawn(issueId, 'work', false, workspacePath).catch(() => undefined));
        stackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
      }
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
          emitActivityEntry({
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

    // PAN-3917: planning artifacts live in the repo's `.pan/` and are committed
    // by the agent that changes them (FR-2). The dashboard no longer commits and
    // pushes a workspace copy on the agent's behalf before start.

    let gatesCommitted = false;
    const commitClearedGates = async (): Promise<void> => {
      if (!startGateBlock || gatesCommitted) return;
      gatesCommitted = true;
      if (startGateBlock.paused) {
        await Effect.runPromise(eventStore.appendAsync(operatorInterventionEvent({ issueId, kind: 'unpause', source: 'dashboard' })));
      }
      if (startGateBlock.troubled) {
        await Effect.runPromise(eventStore.appendAsync(operatorInterventionEvent({ issueId, kind: 'untroubled', source: 'dashboard' })));
      }
      await appendAgentLifecycleLog(agentSessionName, 'agent.start_gates_cleared', {
        issueId,
        paused: startGateBlock.paused,
        troubled: startGateBlock.troubled,
      });
    };
    let workStartAccepted = false;
    const markWorkStartAccepted = async (): Promise<void> => {
      if (workStartAccepted) return;
      workStartAccepted = true;
      await transitionXBriefOnMain(
        projectPath,
        issueId,
        'active',
        'running',
        `chore(state): start ${issueId.toUpperCase()} xBRIEF (status=running)`,
      ).then(
        (result) => {
          if (result.moved) {
            console.log(`[start-agent] xBRIEF moved ${result.fromDir} → active for ${issueId}`);
          }
          if (result.statusUpdated) {
            console.log(`[start-agent] Set plan.status=running for ${issueId}`);
          }
          if (result.committed) {
            console.log(`[start-agent] Committed running transition for ${issueId}`);
          }
        },
        (err: unknown) => {
          console.warn(`[start-agent] xBRIEF running transition failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        },
      );

      if (planPath.startsWith(workspacePath + sep)) {
        try {
          updatePlanStatus(planPath, 'running');
          console.log(`[start-agent] Set plan.status=running for ${issueId}`);
        } catch (planStatusErr: any) {
          console.warn(`[start-agent] Failed to set plan.status=running (non-fatal): ${planStatusErr?.message ?? planStatusErr}`);
        }
      }

      // PAN-3917: the record's sessionHistory and the workspace `stuck` flag
      // are gone. The agent.started event (emitted by the PTY supervisor when
      // the harness process exists) is the durable record that this agent
      // started, and a stuck agent is derived — idle with unpushed commits.
    };
    if (isRemote && workspaceMetadata) {
      const response = yield* Effect.promise(() => spawnAfterClearingStartGates({
          agentSessionName,
          gate: startGateBlock,
          initialState: initialAgentState,
          spawn: () => Effect.runPromise(handleRemoteAgentSpawn({
            issueId,
            workspacePath,
            workspaceMetadata,
            spawnModel,
            startedBy,
            autoSpawnConsentRequired,
            projectPath,
            spawnGuardrails,
            lifecycle,
          })),
          isSuccessful: (remoteResponse) => remoteResponse.status >= 200 && remoteResponse.status < 300,
      }));
      if (response.status < 200 || response.status >= 300) return response;
      yield* Effect.promise(commitClearedGates);
      yield* Effect.promise(markWorkStartAccepted);
      return response;
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

    const agentLifecycle = yield* Effect.promise(() => getWorkAgentLifecycleState(agentSessionName));
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
        const { stdout: statusOut } = yield* Effect.promise(() => execAsync('git status --porcelain --untracked-files=all', {
          cwd: workspacePath,
          encoding: 'utf-8',
        }));
        if (statusOut.trim() && !isOnlyOverdeckRuntimeWorkspaceChanges(statusOut)) {
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
    const userPickedHarness: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | null =
      bodyHarness === 'ohmypi' || bodyHarness === 'claude-code' || bodyHarness === 'codex' || bodyHarness === 'acp' || bodyHarness === 'kimi-code' || bodyHarness === 'opencode' || bodyHarness === 'muse' ? bodyHarness : null;
    let effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | null = null;
    if (userPickedHarness !== null) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarness(userPickedHarness, spawnModel, await getProviderAuthMode(spawnModel))
      );
      // PAN-1837 review fix (NFR-2): an explicitly requested harness that
      // policy denies must fail loudly, not silently substitute claude-code —
      // {harness: 'kimi-code', model: 'claude-sonnet-5'} was previously
      // accepted and spawned claude-code instead of returning the policy
      // reason.
      if (!harnessDecision.allowed) {
        return jsonResponse({ error: harnessDecision.reason ?? `Harness "${userPickedHarness}" is not allowed for model "${spawnModel}".` }, { status: 400 });
      }
      effectiveHarness = userPickedHarness;
    }

    // Spawn pan start command
    const spawnPanCommand = async (args: string[], cwd?: string): Promise<string> => {
      const output = await spawnAfterClearingStartGates({
        agentSessionName,
        gate: gatesCommitted ? null : startGateBlock,
        initialState: initialAgentState,
        spawn: () => spawnPanCommandDetached({
          agentSessionName,
          issueId,
          role,
          workspacePath,
          args,
          cwd,
          env: {
            OVERDECK_AGENT_STARTED_BY: startedBy,
            OVERDECK_AUTO_SPAWN_CONSENT_REQUIRED: autoSpawnConsentRequired ? '1' : '0',
          },
        }),
      });
      await commitClearedGates();
      return output;
    };

    // Use IssueLifecycle service to transition issue to "In Progress" (PAN-449)
    const updateIssueStatus = async () => {
      await Effect.runPromise(
        lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
      );
    };

    // Claim BEFORE container orchestration (PAN-3849 W34): the claim is the
    // no-placeholder replacement for the retired pending- rows. The direct
    // path below releases it when the spawn settles; the container-wait
    // background job retains it until it spawns or gives up — so concurrent
    // requests 409 here instead of starting duplicate container waits.
    if (!claimAgentStart(agentSessionName)) {
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_in_flight_blocked', {
        issueId,
        role,
        workspacePath,
      }));
      return jsonResponse({
        error: `Agent ${agentSessionName} is already starting or running.`,
        code: 'AGENT_START_IN_FLIGHT',
      }, { status: 409 });
    }

    // Orchestration takes the request into a background job (claim retained
    // there). If its Effect fails instead, no background job exists to
    // release the claim — release here and re-raise the original cause.
    const containerExit = yield* Effect.exit(handleContainerOrchestration({
      issueId,
      workspacePath,
      devScript,
      agentSessionName,
      role,
      effectiveHarness,
      startedBy,
      allowHost,
      explicitModel,
      spawnGuardrails,
      projectPath,
      eventStore,
      spawnPanCommand,
      markWorkStartAccepted,
      updateIssueStatus,
    }));
    if (Exit.isFailure(containerExit)) {
      releaseAgentStart(agentSessionName);
      return yield* Effect.failCause(containerExit.cause);
    }
    const containerResponse = containerExit.value;
    if (containerResponse) return containerResponse;

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_requested', {
      issueId,
      role,
      workspacePath,
    }));

    // Effect failures are values, not JS exceptions (see lifecycle-restart):
    // a JS try/catch/finally around `yield*` never sees a spawnPanCommand
    // rejection (Effect.promise turns it into a defect) — the mapped errors
    // below would never render and the claim would leak. Capture the Exit so
    // both run on every outcome.
    const spawnExit = yield* Effect.exit(Effect.gen(function* () {
      emitStartAgentPhase(issueId, 'spawn', 'start', 'starting local work agent', { workspacePath });
      const id = yield* Effect.promise(() => spawnPanCommand(
        buildPanStartArgs({
          issueId,
          model: explicitModel,
          harness: effectiveHarness,
          allowHost,
          offBook,
        }),
        workspacePath,
      ));
      yield* Effect.promise(markWorkStartAccepted);
      emitStartAgentPhase(issueId, 'spawn', 'success', 'local work agent spawn requested', {
        workspacePath,
        activityId: id,
      });
      return id;
    }));
    releaseAgentStart(agentSessionName);
    if (Exit.isFailure(spawnExit)) {
      const error: any = Cause.squash(spawnExit.cause);
      // Nothing to roll back (PAN-3849 W34): no placeholder was written, so a
      // failed spawn leaves whatever state existed before — usually none — and
      // a later `pan start` proceeds fresh instead of being refused by a
      // stranded 'pending-' placeholder row (F2).
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_spawn_failed', {
        issueId,
        message: error instanceof Error ? error.message : String(error),
      }));
      invalidateAgentsCache();

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
        emitActivityEntry({
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
    const activityId = spawnExit.value;

    updateRegistryForAgentStart(issueId, workspacePath, agentSessionName);
    yield* Effect.promise(() => updateIssueStatus());
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
