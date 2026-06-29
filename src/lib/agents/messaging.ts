import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { appendOperatorInterventionEvent } from '../operator-interventions.js';
import { logAgentLifecycleSync } from '../persistent-logger.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from '../providers.js';
import { ALLOW_SESSION_ROTATION_ON_RESUME } from '../session-rotation.js';
import type { ModelId } from '../settings.js';
import { createSession, killSession, listPaneValues, sessionExists } from '../tmux.js';
import {
  clearReadySignal,
  normalizeAgentId,
  waitForAgentIdle,
} from './identity.js';
import {
  getAgentDir,
  getAgentResumeGateBlockReason,
  getAgentStateSync,
  markAgentRunning,
  saveAgentStateSync,
  type AgentState,
  type Role,
} from './agent-state.js';
import { getLatestSessionIdSync } from './activity.js';
import {
  deliverAgentMessage,
  deliverResumeMessageWithTranscriptConfirmation,
  resilientDeliveryMethod,
} from './delivery.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';
import {
  claudeSystemPromptFiles,
  getCodexLauncherFields,
  getOhmypiLauncherFields,
  getRoleRuntimeBaseCommand,
  hasAgentRuntimeInSubtree,
  waitForPromptReady,
} from './runtime-command.js';
import {
  buildResumeMessageForAgent,
  markKickoffRedelivered,
  prepareSupervisorForRelaunch,
} from './supervisor-channels.js';
import {
  getProviderEnvForModel,
  getProviderExportsForModel,
} from './provider-env.js';

function queueAgentMail(agentId: string, message: string): void {
  const mailDir = join(getAgentDir(agentId), 'mail');
  mkdirSync(mailDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

const USER_MESSAGE_INTERVENTION_SOURCES = new Set(['pan-tell', 'dashboard:user-message']);

async function appendTellInterventionForUserSource(normalizedId: string, caller: string): Promise<void> {
  if (!USER_MESSAGE_INTERVENTION_SOURCES.has(caller)) return;

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState?.issueId) {
    console.debug(`[agents] Skipping tell intervention for ${normalizedId}; state.json has no issueId`);
    return;
  }

  await appendOperatorInterventionEvent({
    issueId: agentState.issueId,
    kind: 'tell',
    source: caller,
  });
}

export async function messageAgent(agentId: string, message: string, caller = 'internal'): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    queueAgentMail(normalizedId, message);
    logAgentLifecycleSync(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
    console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
    return;
  }

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  if (runtimeState?.state === 'suspended') {
    console.log(`[agents] Auto-resuming suspended agent ${normalizedId} to deliver message`);
    const { resumeAgent } = await import('../agents.js');
    const result = await resumeAgent(normalizedId, message);
    if (!result.success) {
      throw new Error(`Failed to auto-resume agent: ${result.error}`);
    }
    if (result.messageDelivered === false) {
      throw new Error(`Agent resumed but ready signal did not fire — message not delivered. Feedback is in the mail queue.`);
    }
    // Message already sent during resume
    await appendTellInterventionForUserSource(normalizedId, caller);
    return;
  }

  // Check if agent is stopped — auto-resume to deliver feedback (PAN-367 / PAN-705)
  //
  // IMPORTANT: We delegate to resumeAgent() so we pick up the saved Claude session id
  // (`claude --resume <id>`) instead of fresh-launching with a new, empty session.
  // The previous implementation of this branch called `getAgentRuntimeBaseCommand(model)`
  // and passed an inline "You are resuming work" prompt as a positional argument,
  // which booted Claude Code in a fresh session (ctx 0%) with no memory of the
  // prior conversation, destroying agent continuity every time feedback arrived.
  //
  // We also restart when the tmux session still exists. Planning/work sessions use
  // `remain-on-exit on` so the shell persists after the agent process exits, and
  // sessionExists() returns true for that dead shell. resumeAgent() kills the zombie
  // session before re-creating it.
  if (agentState && agentState.status === 'stopped') {
    console.log(`[agents] Auto-resuming stopped agent ${normalizedId} to deliver feedback (session exists: ${await Effect.runPromise(sessionExists(normalizedId))})`);

    const { resumeAgent } = await import('../agents.js');
    const resumeResult = await resumeAgent(normalizedId, message);

    // Save to mail queue regardless so the agent can re-read feedback if needed
    queueAgentMail(normalizedId, message);

    if (resumeResult.success && resumeResult.messageDelivered !== false) {
      await appendTellInterventionForUserSource(normalizedId, caller);
      console.log(`[agents] Resumed ${normalizedId} and delivered feedback`);
      return;
    }

    // Resume failed OR message was not delivered (ready signal timed out). Fall back to
    // a fresh launch so feedback is not silently dropped. This path intentionally mirrors
    // spawnAgent's launcher (provider exports + unset of leaked env vars) so the fallback
    // doesn't inherit stale ANTHROPIC_BASE_URL / OPENAI_API_KEY from the parent process.
    if (!resumeResult.success) {
      console.warn(`[agents] Resume failed for ${normalizedId}: ${resumeResult.error} — falling back to fresh launch`);
    } else {
      console.warn(`[agents] Resume succeeded for ${normalizedId} but message not delivered (ready signal timed out) — falling back to fresh launch`);
    }

    // PAN-1980: session rotation is disabled — do NOT fresh-launch a new session
    // as a fallback (that rotates the transcript and hides the resume failure).
    // Leave the agent stopped and surface it; the feedback was already queued in
    // the mail queue above, so it is not dropped.
    if (!ALLOW_SESSION_ROTATION_ON_RESUME) {
      const why = !resumeResult.success
        ? `resume failed (${resumeResult.error})`
        : 'resume succeeded but message delivery timed out';
      const stopMsg = `Not restarting ${normalizedId} with a fresh session — ${why}; session rotation is disabled (PAN-1980). Agent left stopped; feedback queued in mail.`;
      console.warn(`[agents] ${stopMsg}`);
      emitActivityEntrySync({ source: 'work-agent', level: 'error', message: `${normalizedId}: ${stopMsg}`, issueId: agentState.issueId });
      return;
    }

    const providerEnv = agentState.model ? await getProviderEnvForModel(agentState.model) : {};
    if (agentState.model) {
      const provider = getProviderForModelSync(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuthSync(provider, agentState.workspace);
      } else {
        clearCredentialFileAuthSync(agentState.workspace);
      }
    }

    clearReadySignal(normalizedId);
    if (await Effect.runPromise(sessionExists(normalizedId))) {
      try { await Effect.runPromise(killSession(normalizedId)); } catch { /* ignore */ }
    }

    const providerExports = await getProviderExportsForModel(agentState.model || 'claude-sonnet-4-6');
    const fallbackLauncher = join(getAgentDir(normalizedId), 'launcher.sh');
    // PAN-1048 C4: resume must relaunch with the agent's actual role, not
    // hardcoded 'work'. A stopped review/test/ship run was previously
    // resurrected as a work agent because launcher generation ignored the
    // saved role. Use agentState.role and route through getRoleRuntimeBaseCommand
    // so the role-specific .claude/agents/* definition file is loaded.
    const resumeRole: Role = agentState.role ?? 'work';
    // PAN-1048 review feedback 006 (S1): Pi-backed resumes need the same
    // launcher fields the fresh-spawn path threads through generateLauncherScript.
    // buildPiCommand throws on missing piSessionDir, so the previous fallback
    // emitted a launcher that would crash on resume for any Pi role agent.
    const resumeModel = agentState.model || 'claude-sonnet-4-6';
    const fallbackHarness = agentState.harness ?? 'claude-code';
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      resumeRole,
      agentState.hostOverride === true,
      agentState.workspace,
    );
    const fallbackPiFields = fallbackHarness === 'ohmypi'
      ? await getOhmypiLauncherFields(normalizedId, resumeModel)
      : {};
    const fallbackCodexFields = fallbackHarness === 'codex'
      ? getCodexLauncherFields(normalizedId, resumeModel, agentState.workspace)
      : {};
    const fallbackSupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, resumeModel, fallbackHarness);
    const fallbackContent = generateLauncherScriptSync({
      role: resumeRole,
      workingDir: agentState.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      baseCommand: await getRoleRuntimeBaseCommand(
        resumeModel,
        normalizedId,
        resumeRole,
        fallbackHarness,
      ),
      appendSystemPromptFiles: await claudeSystemPromptFiles(agentState.workspace, fallbackHarness),
      useSupervisor: fallbackSupervisorLaunch.useSupervisor,
      supervisorScriptPath: fallbackSupervisorLaunch.supervisorScriptPath,
      ...fallbackPiFields,
      ...fallbackCodexFields,
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await Effect.runPromise(createSession(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    const ready = await waitForPromptReady(normalizedId, fallbackHarness, 30);
    const fallbackResumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    const resumeMessage = await buildResumeMessageForAgent(agentState, fallbackResumePrompt, message);
    if (resumeMessage.error) {
      console.error(`[agents] Fallback-restarted ${normalizedId} but ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId: agentState.issueId,
      });
    } else if (ready && resumeMessage.message) {
      let delivered = false;
      if (fallbackHarness === 'claude-code') {
        const fallbackSessionId = getLatestSessionIdSync(normalizedId);
        if (fallbackSessionId) {
          const delivery = await deliverResumeMessageWithTranscriptConfirmation({
            agentId: normalizedId,
            workspace: agentState.workspace,
            sessionId: fallbackSessionId,
            message: resumeMessage.message,
            caller: 'resumeAgent:resume-prompt',
            deliveryMethod: resilientDeliveryMethod(agentState.deliveryMethod),
          });
          delivered = delivery.delivered;
          if (!delivery.delivered) {
            console.error(`[agents] Fallback resume prompt did not land after ${delivery.attempts} delivery attempts`);
          }
        } else {
          console.error(`[agents] Fallback-restarted ${normalizedId} but no session id was recorded — feedback in mail queue`);
        }
      } else {
        const delivery = await deliverAgentMessage(normalizedId, resumeMessage.message, 'resumeAgent:resume-prompt', resilientDeliveryMethod(agentState.deliveryMethod));
        delivered = delivery.ok;
      }
      if (delivered) {
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
        await appendTellInterventionForUserSource(normalizedId, caller);
        console.log(`[agents] Fallback-restarted ${normalizedId} and delivered feedback`);
      }
    } else {
      console.warn(`[agents] Fallback-restarted ${normalizedId} but ready signal not detected — feedback in mail queue`);
    }

    return;
  }

  // Check if this is a remote agent
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('../remote/remote-agents.js');
  const remoteState = loadRemoteAgentState(normalizedId);
  if (remoteState && remoteState.vmName) {
    console.log(`[agents] Sending message to remote agent ${normalizedId} on ${remoteState.vmName}`);
    await sendToRemoteAgent(normalizedId, remoteState.vmName, message);

    // Also save to mail queue for persistence
    queueAgentMail(normalizedId, message);
    await appendTellInterventionForUserSource(normalizedId, caller);
    return;
  }

  if (!(await Effect.runPromise(sessionExists(normalizedId)))) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  // Guard: if tmux session exists but Claude Code has exited, resume instead
  // of typing the message into a bare bash shell.
  //
  // Launchers differ: specialists `exec claude` so pane_pid IS claude, but
  // work-agent launchers run `bash launcher.sh` so pane_pid is bash and claude
  // runs as a descendant. Walk the pane's process subtree and treat the pane
  // as live if any descendant is the expected runtime for the saved harness.
  const panePids = await Effect.runPromise(listPaneValues(normalizedId, '#{pane_pid}'));
  const expectedHarness = agentState?.harness ?? 'claude-code';
  if (panePids.length > 0 && !(await hasAgentRuntimeInSubtree(panePids[0], expectedHarness))) {
    console.warn(`[agents] ${normalizedId} tmux session is a zombie (no ${expectedHarness} runtime) — attempting resume`);
    const { resumeAgent } = await import('../agents.js');
    const resumeResult = await resumeAgent(normalizedId, message);
    if (resumeResult.success) {
      if (resumeResult.messageDelivered !== false) {
        await appendTellInterventionForUserSource(normalizedId, caller);
      }
      return;
    }
    throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
  }

  // Wait for the agent to be idle at the prompt before sending — reduces dropped
  // Enter when Claude Code is still rendering. PAN-1594: hook-driven (runtime
  // mirror 'idle' via Stop/SessionStart hook), not a tmux pane-scrape.
  const promptReady = await waitForAgentIdle(normalizedId, 5000);
  if (!promptReady) {
    console.warn(`[agents] ${normalizedId} not at idle prompt after 5s — sending message anyway`);
  }

  const deliveryMethod = resilientDeliveryMethod(agentState?.deliveryMethod);
  await deliverAgentMessage(normalizedId, message, `messageAgent:${caller}`, deliveryMethod);

  // Also save to mail queue
  queueAgentMail(normalizedId, message);
  await appendTellInterventionForUserSource(normalizedId, caller);
}
