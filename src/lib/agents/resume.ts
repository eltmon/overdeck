import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { buildCompactRecoverySeedMessage } from '../context-overflow.js';
import { resolveHarness } from '../harness-resolve.js';
import { normalizeModelOverrideSync, requireModelOverrideSync } from '../model-validation.js';
import { sessionFilePath } from '../paths.js';
import { logAgentLifecycleSync } from '../persistent-logger.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { sessionRotationRefused } from '../session-rotation.js';
import { appendContinueSessionEntryForIssue } from '../vbrief/lifecycle-io.js';
import { createSession, isPaneDead, killSession, listPaneValues, sessionExists } from '../tmux.js';
import {
  getAgentDir,
  getAgentResumeGateBlockReason,
  getAgentStateSync,
  markAgentRunning,
  saveAgentStateSync,
  type AgentState,
} from './agent-state.js';
import { getLatestSessionIdSync, saveSessionId } from './activity.js';
import {
  deliverInitialPromptWithRetry,
  deliverResumeMessageWithTranscriptConfirmation,
  resilientDeliveryMethod,
} from './delivery.js';
import { clearReadySignal, normalizeAgentId, waitForReadySignal } from './identity.js';
import {
  getAgentRuntimeStateSync,
  saveAgentRuntimeState,
  sessionResumeDriftReasons,
} from './runtime-state.js';
import {
  hasAgentRuntimeInSubtree,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './runtime-command.js';
import {
  buildDefaultResumeContinueMessage,
  buildResumeMessageForAgent,
  markKickoffRedelivered,
  prepareSupervisorForRelaunch,
} from './supervisor-channels.js';
import {
  assertWorkspaceStackHealthyForSpawn,
  buildAgentLaunchConfig,
} from './spawn-prep.js';

/**
 * Resume a suspended agent (PAN-80)
 *
 * Reads saved session ID and creates new tmux session with --resume flag.
 * Optionally sends a message after resuming.
 *
 * Auto-resume triggers:
 * - Specialists: When queued work arrives
 * - Work agents: When message is sent via /work-tell
 */
/**
 * PAN-1781: Build the opening prompt for a compact-recovery respawn — an
 * out-of-band summary of the wedged session plus durable-artifact reseed
 * instructions. Replaces PAN-1675's in-place JSONL compaction
 * (compactAgentSession), which appended a compact_boundary the harness's
 * resume leaf selection bypassed ~half the time, silently rebuilding the full
 * pre-compact context. The old JSONL is read-only here — never mutated.
 *
 * Never throws and never returns an unusable seed: smart summary → fallback
 * heuristic summary → reseed-instructions-only, in that order. A missing
 * sessionId or workspace skips straight to the reseed-only seed.
 */
export async function buildCompactRecoverySeed(agentId: string): Promise<{ seed: string; summarized: boolean }> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const sessionId = getLatestSessionIdSync(normalizedId);
  const issueId = agentState?.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();

  let summary: string | null = null;
  if (agentState?.workspace && sessionId) {
    const sessionFile = sessionFilePath(agentState.workspace, sessionId);
    try {
      // Dynamic imports: keep conversation-compaction out of agents.ts's
      // top-level import graph (it pulls in dashboard server services).
      const [{ getConversationCompactionSettings }, { generateSmartSummary }] = await Promise.all([
        import('../../dashboard/server/services/conversation-compaction.js'),
        import('../conversations/smart-compaction.js'),
      ]);
      const settings = getConversationCompactionSettings();
      const result = await Effect.runPromise(generateSmartSummary({
        jsonlPath: sessionFile,
        model: settings.model,
        richMode: settings.richCompaction,
        mode: 'fork',
      }));
      summary = result.summary;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logAgentLifecycleSync(normalizedId, `compact-recovery smart summary failed (${error}); trying heuristic fallback`);
      try {
        const { generateFallbackSummary } = await import('../conversations/summary-fork.js');
        summary = await Effect.runPromise(generateFallbackSummary(sessionFile));
      } catch (fallbackErr) {
        const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logAgentLifecycleSync(normalizedId, `compact-recovery fallback summary failed (${fallbackError}); seeding with reseed instructions only`);
      }
    }
  }

  return {
    seed: buildCompactRecoverySeedMessage(issueId, summary),
    summarized: summary !== null,
  };
}

export async function resumeAgent(agentId: string, message?: string, opts?: { model?: string; harness?: RuntimeName; allowHost?: boolean; compact?: boolean }): Promise<{ success: boolean; messageDelivered?: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const requestedModel = normalizeModelOverrideSync(opts?.model);
  logAgentLifecycleSync(normalizedId, `resumeAgent called (message=${message ? 'yes' : 'no'}, harness=${opts?.harness || 'unchanged'})`);

  // Check runtime state — allow both suspended (auto-suspend) and stopped/idle (manual stop, crash)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    const reason = `Cannot resume ${normalizedId}: ${gateBlockReason}. Clear the gate before resuming.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const isPlaceholder = !!agentState && agentState.status === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const allowedRuntimeStates = ['suspended', 'idle'];
  const allowedAgentStatuses = ['stopped', 'completed'];

  // Also allow resuming a "running" OR "starting" agent with no live tmux session —
  // this happens after a system crash where tmux was killed but state.json was never
  // updated to 'stopped'. For 'starting' this is a spawn that got past model
  // resolution but whose tmux session died mid-launch (the deacon patrol would
  // normally heal starting→stopped after its grace window, but that requires the
  // deacon to be running / not in OVERDECK_NO_RESUME mode). A non-placeholder
  // 'starting' agent with a saved session is resumable exactly like a crashed
  // 'running' agent; placeholder 'starting' agents (model starts with 'pending-')
  // are still rejected below because they never produced a resumable session.
  // The lifecycle UI model already treats runtime=stopped as isStopped, so this
  // keeps the gate consistent with the Resume button that model enables.
  // PAN-2098: a crash leaves the agent at status='running'/'starting' but with no
  // live process. Two shapes: (a) tmux session gone entirely, or (b) the tmux
  // session is still up while the harness process inside its pane has exited — a
  // "keep-alive corpse" (remain-on-exit leaves a dead pane in a live session).
  // The old check used `!sessionExists` alone, so a corpse (session present, pane
  // dead) was misclassified as a healthy running agent and refused resume with a
  // reasonless "Cannot resume … runtime=active, status=running". Treat a dead pane
  // as crashed too, matching the start path (flywheel-actions.ts isPaneDead).
  const isRunningOrStarting = agentState?.status === 'running' || agentState?.status === 'starting';
  const sessionAlive = isRunningOrStarting ? await Effect.runPromise(sessionExists(normalizedId)) : false;
  const paneDead = isRunningOrStarting && (!sessionAlive || await Effect.runPromise(isPaneDead(normalizedId)));
  const isCrashed = isRunningOrStarting && paneDead;

  // PAN-1675 (keystone): a `compact` resume exists specifically to recover a
  // context-wedged agent, which is typically status='running' with a LIVE (but
  // stuck) tmux session sitting at an overflow/idle prompt. The normal canResume
  // gate rejects running+live-session agents — which would make
  // resumeAgent({compact:true}) (the deacon's overflow recovery tiers AND
  // `pan resume --compact`) a silent no-op for exactly the agents it targets.
  // So a compact-resume of a running agent is allowed: the flow below compacts
  // the JSONL out-of-band and then kills the wedged session before relaunch.
  // This is safe because the only callers of {compact:true} act on agents they
  // have already determined to be context-overflow-wedged.
  const isCompactRecovery = opts?.compact === true && agentState?.status === 'running';

  const canResume = (runtimeState && allowedRuntimeStates.includes(runtimeState.state))
    || (agentState && allowedAgentStatuses.includes(agentState.status))
    || isCrashed
    || isCompactRecovery;

  if (!canResume) {
    // PAN-2098: never refuse without a concrete reason. A running/starting agent
    // that reached here has a live session AND a live pane (a crash would have set
    // isCrashed above), so it is genuinely healthy and there is nothing to resume.
    const reason = isRunningOrStarting
      ? `Cannot resume ${normalizedId}: it appears healthy (tmux session up, harness process alive) — there is nothing to resume. Stop it first if you intend to restart it.`
      : `Cannot resume ${normalizedId}: runtime=${runtimeState?.state || 'unknown'}, status=${agentState?.status || 'unknown'} is not a resumable state.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  // Get saved session ID from any available source
  const sessionId = getLatestSessionIdSync(normalizedId);
  if (!sessionId) {
    // PAN-2098: state the concrete reason. ohmypi now resolves from its session
    // JSONL (see getLatestSessionIdSync); reaching here means no id exists in any
    // source for this harness, so a fresh start is genuinely the only option.
    const harnessLabel = agentState?.harness ?? 'unknown';
    const reason = `Cannot resume ${normalizedId} (harness=${harnessLabel}): no resumable session id found — no session.id file, no sessions.json entry, and no recoverable session transcript on disk. Start a fresh agent instead.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  if (!agentState || !hasWorkspace || isPlaceholder) {
    const reason = 'Saved Claude session is orphaned because the backing workspace/agent state is missing or placeholder-only. Start a fresh agent instead.';
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      opts?.allowHost === true || agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  // PAN-1781: compact recovery = summarize the wedged session out-of-band and
  // respawn a FRESH session seeded with that summary. The previous approach
  // (PAN-1675: append a compact_boundary to the JSONL and relaunch with
  // --resume) was silently bypassed by the harness's resume leaf selection
  // ~half the time in the field — the relaunched session rebuilt the full
  // pre-compact context, re-overflowed, and escalated to /clear. A fresh
  // seeded session has nothing stale to rewind to, so its starting context is
  // bounded by construction. The old JSONL stays untouched on disk.
  // buildCompactRecoverySeed never throws: it degrades smart summary →
  // heuristic summary → reseed-instructions-only.
  let compactSeed: string | null = null;
  if (opts?.compact) {
    const seedResult = await buildCompactRecoverySeed(normalizedId);
    compactSeed = seedResult.seed;
    logAgentLifecycleSync(normalizedId, `compact recovery: respawning fresh session (seed=${seedResult.summarized ? 'summary' : 'reseed-only'})`);
  }

  // PAN-2009: capture whether the ohmypi process is actually alive BEFORE we kill any
  // zombie session below. A DEAD omp process cannot be resumed by session id —
  // `omp --resume` against a cleaned-up session never writes ready.json (the "did
  // not become ready within 30s" hang) — and there is no live transcript to
  // protect, so it must be fresh-launched (recovery, not rotation). A live
  // (suspended) omp process stays on the normal resume path.
  const piProcessWasAlive = getHarnessBehavior(agentState.harness).usesRpcFifo
    ? await hasAgentRuntimeInSession(normalizedId, 'ohmypi')
    : false;

  // Kill any zombie tmux session (crashed agent left behind)
  if (await Effect.runPromise(sessionExists(normalizedId))) {
    try {
      await Effect.runPromise(killSession(normalizedId));
    } catch { /* non-fatal */ }
  }

  // Remove completed marker so the agent can work again
  const completedFile = join(getAgentDir(normalizedId), 'completed');
  if (existsSync(completedFile)) {
    try { unlinkSync(completedFile); } catch { /* non-fatal */ }
  }

  // Append 'resume' session entry to continue state (PAN-946: workspace-44p)
  try {
    if (agentState?.workspace) {
      const issueId = agentState.issueId || normalizedId.replace('agent-', '').toUpperCase();
      const resolved = resolveProjectFromIssueSync(issueId);
      if (resolved) {
        appendContinueSessionEntryForIssue(resolved.projectPath, issueId, {
          reason: 'resume',
          agentModel: agentState.model || undefined,
        });
      }
    }
  } catch (continueErr: any) {
    console.warn(`[resumeAgent] Failed to append resume entry to continue state (non-fatal): ${continueErr?.message ?? continueErr}`);
  }

  try {
    const resumeStartedAt = new Date().toISOString();
    // Clear ready signal before resuming (clean slate for PAN-87 fix)
    clearReadySignal(normalizedId);

    const model = requestedModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
    if (requestedModel && requestedModel !== agentState.model) {
      agentState.model = requestedModel;
      saveAgentStateSync(agentState);
    }
    // PAN-1797: agents predating session-origin metadata must not have their
    // stored harness treated as `explicit` on auto-resume — that pins a stale
    // pairing (e.g. gpt-5.5 on claude-code) over the provider default forever.
    // Re-resolve from the model for origin-less agents (only an operator-supplied
    // opts.harness counts as explicit); agents WITH origin metadata keep prior
    // behavior and are handled by sessionResumeDriftReasons below.
    const hasSessionOrigin = !!(runtimeState?.sessionModel && runtimeState?.sessionHarness);
    const priorHarness = agentState.harness;
    const effectiveHarness = await resolveHarness({
      explicit: hasSessionOrigin ? (opts?.harness ?? agentState.harness) : opts?.harness,
      role: agentState.role,
      model,
    });
    const legacyHarnessMigrated =
      !hasSessionOrigin && priorHarness !== undefined && priorHarness !== effectiveHarness;
    agentState.harness = effectiveHarness;
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, model, effectiveHarness);
    saveAgentStateSync(agentState);
    const resumeDriftReasons = sessionResumeDriftReasons(runtimeState, model, effectiveHarness);
    if (legacyHarnessMigrated) {
      // PAN-1797: force a fresh session so the re-defaulted harness takes effect;
      // never reuse a session across a harness change.
      resumeDriftReasons.push(`legacy harness ${priorHarness}→${effectiveHarness} (PAN-1797 re-default)`);
    }
    // PAN-2009: a dead ohmypi process is fresh-launchable recovery — force a fresh
    // session (no `omp --resume`, which would hang waiting for ready.json) instead
    // of a doomed resume-by-id. This is NOT session rotation (no live session or
    // transcript exists to protect), so it is exempt from the PAN-1980 refusal
    // below — it adds no compact seed and no drift reason. Live (suspended) omp and
    // compact/drift resumes are unaffected.
    const piDeadRecovery = effectiveHarness === 'ohmypi' && !piProcessWasAlive
      && !compactSeed && resumeDriftReasons.length === 0;
    if (piDeadRecovery) {
      logAgentLifecycleSync(normalizedId, 'resumeAgent: dead ohmypi process — fresh-launching for recovery instead of omp --resume (PAN-2009)');
    }
    const shouldResumeSavedSession = !compactSeed && resumeDriftReasons.length === 0 && !piDeadRecovery;
    // PAN-1980: refuse to rotate to a new session. A resume that would need a
    // fresh session — compact/overflow recovery or model/harness drift — now
    // errors and stops instead of starting a new transcript.
    if (sessionRotationRefused({ compactSeed: Boolean(compactSeed), driftReasons: resumeDriftReasons })) {
      const reason = compactSeed
        ? 'context-overflow compaction would respawn a fresh session'
        : `session drift (${resumeDriftReasons.join(', ')})`;
      const errMsg = `Refusing to rotate ${normalizedId} to a new session — ${reason}; session rotation is disabled (PAN-1980). Agent left stopped.`;
      logAgentLifecycleSync(normalizedId, `resumeAgent: ${errMsg}`);
      emitActivityEntrySync({ source: 'work-agent', level: 'error', message: `${normalizedId}: ${errMsg}`, issueId: agentState.issueId });
      return { success: false, error: errMsg };
    }
    const freshSessionId = !shouldResumeSavedSession && effectiveHarness === 'claude-code'
      ? randomUUID()
      : undefined;
    if (resumeDriftReasons.length > 0) {
      logAgentLifecycleSync(normalizedId, `resumeAgent: starting fresh session instead of --resume because session origin drifted (${resumeDriftReasons.join(', ')})`);
    }
    if (freshSessionId) {
      saveSessionId(normalizedId, freshSessionId);
    } else if (!shouldResumeSavedSession) {
      try {
        unlinkSync(join(getAgentDir(normalizedId), 'session.id'));
      } catch { /* absent or already cleared */ }
    }

    // Compute the effective message before building the launcher so codex can
    // embed it as the inline prompt in `codex exec resume <threadId> <message>`.
    // PAN-1781: a compact recovery skips the kickoff-redelivery machinery — its
    // seed (summary + reseed instructions) IS the opening prompt of the fresh
    // session; a caller-supplied message rides along after it.
    const issueId = agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();
    const defaultResumeMessage = buildDefaultResumeContinueMessage(issueId);
    const resumeMessage: { message?: string; redeliveringKickoff: boolean; error?: string } = compactSeed
      ? { message: message ? `${compactSeed}\n\n${message}` : compactSeed, redeliveringKickoff: false }
      : resumeDriftReasons.length > 0
        ? { message: message ?? defaultResumeMessage, redeliveringKickoff: false }
      : await buildResumeMessageForAgent(agentState, defaultResumeMessage, message);
    if (resumeMessage.error) {
      console.error(`[resumeAgent] ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId,
      });
      return { success: false, error: resumeMessage.error };
    }
    const effectiveMessage = resumeMessage.message ?? defaultResumeMessage;

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      // PAN-1781/PAN-1787: compact recovery and model/harness drift launch a
      // fresh session. Normal resumes keep re-attaching to the saved session.
      ...(shouldResumeSavedSession ? { spawnMode: 'resume' as const, resumeSessionId: sessionId } : {}),
      sessionId: freshSessionId,
      harness: effectiveHarness,
      useSupervisor: supervisorLaunch.useSupervisor,
      supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await Effect.runPromise(createSession(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    // Always wake the resumed agent with a continue prompt — without it, the
    // re-attached session sits silently at its last state, and the user (or
    // deacon nudge loop) ends up sending one manually anyway. Default matches
    // restartAgent's wording so behaviour is consistent across both entry points.
    // Caller-supplied message wins.

    let messageDelivered = false;
    if (effectiveHarness === 'ohmypi') {
      // ohmypi does not fire the Claude SessionStart hook; wait for ready.json and
      // deliver the auto-continue prompt through the FIFO JSONL protocol.
      try {
        await writeOhmypiAgentPrompt(normalizedId, effectiveMessage);
        messageDelivered = true;
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[resumeAgent] ohmypi prompt delivery failed: ${msg}`);
      }
    } else if (effectiveHarness === 'codex') {
      const delivery = await deliverInitialPromptWithRetry(normalizedId, effectiveMessage, 'resumeAgent:codex-continue', resilientDeliveryMethod(agentState.deliveryMethod));
      messageDelivered = delivery.ok;
      if (delivery.ok && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      if (!delivery.ok) {
        console.error(`[resumeAgent] Codex continue prompt did not land: ${delivery.failure ?? 'unknown failure'}`);
      }
    } else if (!shouldResumeSavedSession) {
      // Fresh session fallback — deliver like a kickoff. Transcript
      // confirmation is impossible here: the new session's id is unknown until
      // its SessionStart hook fires, and the saved sessionId points at the
      // archived or mismatched session. deliverInitialPromptWithRetry waits for
      // the ready signal internally.
      const delivery = await deliverInitialPromptWithRetry(normalizedId, effectiveMessage, 'resumeAgent:compact-seed', resilientDeliveryMethod(agentState.deliveryMethod));
      messageDelivered = delivery.ok;
      if (!delivery.ok) {
        console.error(`[resumeAgent] Fresh-session continue prompt did not land: ${delivery.failure ?? 'unknown failure'}`);
      }
    } else {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);
      if (ready) {
        const delivery = await deliverResumeMessageWithTranscriptConfirmation({
          agentId: normalizedId,
          workspace: agentState.workspace,
          sessionId,
          message: effectiveMessage,
          caller: 'resumeAgent:auto-continue',
          deliveryMethod: resilientDeliveryMethod(agentState.deliveryMethod),
        });
        messageDelivered = delivery.delivered;
        if (delivery.delivered && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
        if (!delivery.delivered) {
          console.error(`[resumeAgent] Auto-continue prompt did not land after ${delivery.attempts} delivery attempts`);
        }
      } else {
        console.error('Claude SessionStart hook did not fire during resume, continue prompt not sent');
      }
    }

    const resumedAt = new Date().toISOString();
    if (compactSeed) {
      console.log(`[agents] Respawned ${normalizedId} fresh with compact-recovery seed (archived session ${sessionId}${freshSessionId ? `, new session ${freshSessionId}` : ''})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: compact-recovery fresh respawn (archived sessionId=${sessionId}${freshSessionId ? `, newSessionId=${freshSessionId}` : ''}), messageDelivered=${messageDelivered}`);
    } else if (piDeadRecovery) {
      console.log(`[agents] Respawned ${normalizedId} fresh because the prior Pi process was dead (archived session ${sessionId})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: fresh respawn after dead Pi process (archived sessionId=${sessionId}), messageDelivered=${messageDelivered}`);
    } else if (!shouldResumeSavedSession) {
      console.log(`[agents] Respawned ${normalizedId} fresh because session origin drifted (archived session ${sessionId}${freshSessionId ? `, new session ${freshSessionId}` : ''})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: fresh respawn after origin drift (archived sessionId=${sessionId}${freshSessionId ? `, newSessionId=${freshSessionId}` : ''}), messageDelivered=${messageDelivered}`);
    } else {
      console.log(`[agents] Resumed ${normalizedId} with Claude session ${sessionId}`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: sessionId=${sessionId}, messageDelivered=${messageDelivered}`);
    }
    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: resumedAt,
    });

    // Update agent state
    if (agentState) {
      agentState.lastResumeAt = resumeStartedAt;
      markAgentRunning(agentState, { preserveFailureTracking: true });
      saveAgentStateSync(agentState);
    }

    // PAN-1675: a successful compaction-resume genuinely recovers a
    // context-overflow-wedged agent — so clear a context_overflow `stuck` flag
    // here (set by markWorkspaceStuck once the old /compact+/clear ladder
    // exhausted). Without this the agent would stay flagged stuck forever and
    // the deacon's overflowBlocked gate would keep skipping its recovery, even
    // though the agent is now healthy. Only clear when the stuck reason is
    // context_overflow (don't clobber an unrelated stuck state).
    if (opts?.compact && agentState?.issueId) {
      try {
        const { getReviewStatusSync } = await import('../review-status.js');
        const rs = getReviewStatusSync(agentState.issueId);
        if (rs?.stuck && rs.stuckReason === 'context_overflow') {
          const { clearWorkspaceStuck } = await import('../review-status.js');
          clearWorkspaceStuck(agentState.issueId);
          logAgentLifecycleSync(normalizedId, `cleared context_overflow stuck flag after compaction-resume for ${agentState.issueId}`);
        }
      } catch (clearErr) {
        console.warn(`[agents] Could not clear stuck flag after compaction-resume for ${normalizedId}:`, clearErr);
      }
    }

    return { success: true, messageDelivered };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent FAILED: ${msg}`);
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
  }
}

/**
 * Check whether a tmux session has an active agent runtime.
 * A session may exist with only a bare bash shell after Claude exits.
 */
async function hasAgentRuntimeInSession(sessionName: string, harness: RuntimeName): Promise<boolean> {
  try {
    const panePids = await Effect.runPromise(listPaneValues(sessionName, '#{pane_pid}'));
    if (panePids.length === 0) return false;
    return hasAgentRuntimeInSubtree(panePids[0]!, harness);
  } catch {
    return false;
  }
}
