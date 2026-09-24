import { createHash } from 'crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { emitActivityEntry } from '../activity-logger.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { appendOperatorInterventionEvent } from '../operator-interventions.js';
import { logAgentLifecycle } from '../persistent-logger.js';
import { getProviderForModel, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { ALLOW_SESSION_ROTATION_ON_RESUME } from '../session-rotation.js';
import type { ModelId } from '../settings.js';
import { closeAgentPane, launchAgentPane } from '../terminal-backends/launch.js';
import { toPaneRole } from '../terminal-backends/prompt-guard.js';
import { isAlive, isConfirmedDead } from './liveness.js';
import {
  clearReadySignal,
  normalizeAgentId,
  waitForAgentIdle,
} from './identity.js';
import {
  decideResumeGate,
  getAgentDir,
  getAgentResumeGateBlockReason,
  getIssuePause,
  getAgentState,
  markAgentRunning,
  saveAgentStateSync,
  type AgentState,
  type MessageAgentRedriveOptions,
  type ResumeGateDecision,
  type Role,
} from './agent-state.js';
import { getLatestSessionId } from './activity.js';
import {
  deliverAgentMessage,
  deliverMessageWithTranscriptConfirmation,
  resilientDeliveryMethod,
} from './delivery.js';
import { formatMailFileContent } from './monitor-transport.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';
import {
  claudeSystemPromptFiles,
  getCodexLauncherFields,
  getCodexAppServerStatus,
  getOhmypiLauncherFields,
  getRoleRuntimeBaseCommand,
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

export interface MessageDeliveryOutcome {
  delivered: boolean;
  queuedToMail: boolean;
  reason?: string;
  deduplicated?: boolean;
  /** true when a transcript probe saw the message land as a new turn (Claude Code only). */
  confirmed?: boolean;
}

export type MessageAgentOutcome = 'delivered' | 'queued';

/** PAN-3736 — the one phrase for "the message went to the mail file because the
 * agent was busy". It states that the agent is alive, and names the file, so a
 * reader never mistakes a mid-turn agent for a dead one. Turn-end delivery is
 * real for `.pending.md` mail: the codex notify hook replays the oldest pending
 * file at every turn boundary. The phrase still stops short of promising it,
 * because the hook only runs for codex sessions. */
function busyAgentQueuedReason(mailPath: string): string {
  return `agent is alive and mid-turn; message queued to its mail file (${mailPath})`;
}

/**
 * How a mail file is named — which is the same thing as saying who drains it
 * (PAN-3738):
 *
 * - `queued` → `<ts>.md` / `dedup-<hash>.md`. Plain mail: `pan monitor` drains
 *   and prints it (`isPlainMailFile`), `pan inbox` re-reads it.
 * - `pending` → `<ts>.pending.md` / `dedup-<hash>.pending.md`. Busy-turn mail
 *   the codex notify hook replays at the next turn end. The hook drains ONLY
 *   `*.pending.md`, so keyed busy mail must carry the suffix too or it strands.
 * - `delivered` → `<ts>.delivered.md` / `dedup-<hash>.delivered.md`. A
 *   post-delivery durable backup: the message already landed, and the suffix
 *   stops a receipt from reading as queued mail to anyone inspecting `mail/`.
 *   It stays plain mail for the monitor (`.delivered.md` ends with `.md` and
 *   not `.pending.md`), so monitor and inbox behavior is unchanged.
 */
type MailKind = 'queued' | 'pending' | 'delivered';

const MAIL_FILENAME_SUFFIX: Record<MailKind, string> = {
  queued: '.md',
  pending: '.pending.md',
  delivered: '.delivered.md',
};

/** Writes the message to the agent's durable mail dir and returns the file path
 * it wrote, so callers can name it in operator-facing output (PAN-3736). */
function queueAgentMail(
  agentId: string,
  message: string,
  kind: MailKind = 'queued',
  dedupKey?: string,
  source?: string,
): string {
  const mailDir = join(getAgentDir(agentId), 'mail');
  mkdirSync(mailDir, { recursive: true });
  const now = new Date();
  const suffix = MAIL_FILENAME_SUFFIX[kind];
  // Keyed messages get a deterministic filename so a crash-replayed send
  // overwrites the same durable file instead of stacking a second copy.
  const filename = dedupKey !== undefined
    ? `dedup-${createHash('sha256').update(dedupKey).digest('hex').slice(0, 24)}${suffix}`
    : `${now.toISOString().replace(/[:.]/g, '-')}${suffix}`;
  // The provenance header is only written when a source is known (the monitor
  // tier, PAN-3015). Callers that replay mail verbatim (codex notify hook
  // pastes `.pending.md` content) keep the legacy `# Message\n\n<body>` shape.
  const content = source ? formatMailFileContent(message, source, now) : `# Message\n\n${message}\n`;
  const mailPath = join(mailDir, filename);
  writeFileSync(mailPath, content
  );
  return mailPath;
}

const USER_MESSAGE_INTERVENTION_SOURCES = new Set(['pan-tell', 'dashboard:user-message']);

export function resolveAgentDeliveryMethod(
  state: Pick<AgentState, 'harness' | 'deliveryMethod'> | null | undefined,
): 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined {
  if (state?.harness === 'acp' || state?.harness === 'opencode') return 'auto';
  return resilientDeliveryMethod(state?.deliveryMethod);
}

function claimCodexIdleTurn(agentId: string): boolean {
  try {
    unlinkSync(join(getAgentDir(agentId), 'turn-completed'));
    return true;
  } catch {
    return false;
  }
}

async function appendTellInterventionForUserSource(normalizedId: string, caller: string): Promise<void> {
  if (!USER_MESSAGE_INTERVENTION_SOURCES.has(caller)) return;

  const agentState = getAgentState(normalizedId);
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

type DeliveryMethod = 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined;

/** Call the delivery door with the idempotency key only when one is set, so
 * unkeyed callers keep their exact pre-key call shape. */
function deliverWithOptionalKey(
  normalizedId: string,
  message: string,
  caller: string,
  deliveryMethod: DeliveryMethod,
  dedupKey: string | undefined,
) {
  return dedupKey !== undefined
    ? deliverAgentMessage(normalizedId, message, caller, deliveryMethod, { dedupKey })
    : deliverAgentMessage(normalizedId, message, caller, deliveryMethod);
}

/**
 * Keyed delivery to an agent that must be resumed first (PAN-2997 review
 * cycle 7). The keyed message NEVER rides the resume kickoff prompt: the
 * kickoff is delivered by components that cannot enforce the key, so a
 * dashboard crash after the kickoff but before any post-hoc key bookkeeping
 * would replay the wake. Instead the agent is resumed with its bare
 * auto-continue prompt, and the keyed message then goes through the keyed
 * delivery door, where the crash-independent component — the new session's
 * supervisor key set or the tmux session's two-phase markers — enforces
 * at-most-once across the whole replay window.
 */
async function resumeThenDeliverKeyed(
  normalizedId: string,
  message: string,
  caller: string,
  agentState: AgentState | null,
  dedupKey: string,
): Promise<MessageDeliveryOutcome> {
  const { resumeAgent } = await import('../agents.js');
  const result = await resumeAgent(normalizedId);
  if (!result.success) {
    throw new Error(`Failed to auto-resume agent: ${result.error}`);
  }
  const delivery = await deliverAgentMessage(
    normalizedId,
    message,
    `messageAgent:${caller}`,
    resolveAgentDeliveryMethod(agentState),
    { dedupKey },
  );
  await appendTellInterventionForUserSource(normalizedId, caller);
  return {
    delivered: delivery.ok,
    queuedToMail: false,
    ...(delivery.failure ? { reason: delivery.failure } : {}),
    ...(delivery.deduplicated ? { deduplicated: true } : {}),
  };
}


export async function messageAgent(
  agentId: string,
  message: string,
  caller = 'internal',
  opts: MessageAgentRedriveOptions = {},
): Promise<MessageDeliveryOutcome> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentState(normalizedId);

  // PAN-3879: conversations (conv-*) have no agents/<id>/state.json, so the
  // harness must come from the conversation row — the same resolver the
  // dashboard message path uses. Without this, expectedHarness falls back to
  // claude-code and a live acp-host/codex pane reads as a zombie, and the
  // guard below calls resumeAgent, which refuses conversations outright.
  // Lazy import: overdeck/conversations.js deliberately avoids the agents
  // graph (import-cycle comment at its call site), and this keeps the
  // agent hot path import graph unchanged.
  const isConversationTarget = normalizedId.startsWith('conv-');
  let conversationHarness: RuntimeName | undefined;
  if (isConversationTarget && !agentState) {
    try {
      const { getConversationByName } = await import('../overdeck/conversations.js');
      conversationHarness = getConversationByName(normalizedId)?.harness ?? undefined;
    } catch {
      // The conversations store may be unavailable in minimal installs or
      // tests — fall through to the agent-state default below.
    }
  }

  // PAN-2668: pipeline feedback that owes rework (failed verification/review)
  // is a re-drive, not a casual message. Consult the intent policy so the
  // documented completed-handoff exception can clear stoppedByUser and deliver,
  // instead of silently mailing feedback to a queue nothing drains.
  const decideMessageGate = (): ResumeGateDecision => {
    // PAN-3911: an issue pause stops the issue's review and test agents with
    // no per-agent gate; the issue gate is the hold. A message must not resume
    // one of them while the issue is paused (or its pause cannot be read).
    if (agentState && agentState.role !== 'work' && agentState.issueId) {
      const issuePause = getIssuePause(agentState.issueId);
      if (issuePause.status !== 'unpaused') {
        return { decision: 'queue-message', reason: `issue ${agentState.issueId.toUpperCase()} is paused` };
      }
    }
    const block = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
    const agentDir = getAgentDir(normalizedId);
    const hasCompletedHandoff = existsSync(join(agentDir, 'completed'))
      || existsSync(join(agentDir, 'completed.processed'));
    const decision = decideResumeGate(block, 'message-delivery', {
      hasCompletedHandoff,
      owesRework: opts.owesRework === true,
    });
    if (decision.decision === 'proceed' && decision.clearStoppedByUser && agentState) {
      console.log(`[agents] ${normalizedId} was operator-stopped but owes rework after a completed handoff — clearing stop gate to deliver feedback (PAN-2668)`);
      logAgentLifecycle(normalizedId, 'stoppedByUser cleared: completed handoff owes rework; delivering pipeline feedback (PAN-2668)');
      delete agentState.stoppedByUser;
      saveAgentStateSync(agentState);
    }
    return decision;
  };
  if (agentState?.paused === true) {
    const gateBlockReason = getAgentResumeGateBlockReason(agentState)?.reason ?? 'agent is paused';
    queueAgentMail(normalizedId, message, 'queued', opts.dedupKey);
    logAgentLifecycle(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
    console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
    return { delivered: false, queuedToMail: true, reason: gateBlockReason };
  }

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  if (runtimeState?.state === 'suspended') {
    const suspendedGate = decideMessageGate();
    if (suspendedGate.decision !== 'proceed') {
      const gateBlockReason = suspendedGate.reason ?? 'agent is gated';
      queueAgentMail(normalizedId, message, 'queued', opts.dedupKey);
      logAgentLifecycle(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
      console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
      return { delivered: false, queuedToMail: true, reason: gateBlockReason };
    }
    console.log(`[agents] Auto-resuming suspended agent ${normalizedId} to deliver message`);
    if (opts.dedupKey !== undefined) {
      return resumeThenDeliverKeyed(normalizedId, message, caller, agentState, opts.dedupKey);
    }
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
    return { delivered: true, queuedToMail: false };
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
  // `remain-on-exit on` so the shell persists after the agent process exits, and the
  // liveness oracle (src/lib/agents/liveness.ts) reports that dead shell as not alive.
  // resumeAgent() kills the zombie session before re-creating it.
  if (agentState && agentState.status === 'stopped') {
    const stoppedGate = decideMessageGate();
    if (stoppedGate.decision !== 'proceed') {
      const gateBlockReason = stoppedGate.reason ?? 'agent is gated';
      queueAgentMail(normalizedId, message, 'queued', opts.dedupKey);
      logAgentLifecycle(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
      console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
      return { delivered: false, queuedToMail: true, reason: gateBlockReason };
    }
    console.log(`[agents] Auto-resuming stopped agent ${normalizedId} to deliver feedback (alive: ${(await isAlive(normalizedId)).alive})`);

    if (opts.dedupKey !== undefined) {
      // Keyed deliveries resume bare and then enforce the key at the delivery
      // door — no kickoff-riding, no post-hoc key recording, and no mail
      // backup (a keyed mail file is a replay channel: a monitor started
      // later would drain and print it as a second copy).
      return resumeThenDeliverKeyed(normalizedId, message, caller, agentState, opts.dedupKey);
    }

    const { resumeAgent } = await import('../agents.js');
    const resumeResult = await resumeAgent(normalizedId, message);

    // Save to mail queue regardless so the agent can re-read feedback if needed
    queueAgentMail(normalizedId, message);

    if (resumeResult.success && resumeResult.messageDelivered !== false) {
      await appendTellInterventionForUserSource(normalizedId, caller);
      console.log(`[agents] Resumed ${normalizedId} and delivered feedback`);
      return { delivered: true, queuedToMail: true };
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
      emitActivityEntry({ source: 'work-agent', level: 'error', message: `${normalizedId}: ${stopMsg}`, issueId: agentState.issueId });
      return { delivered: false, queuedToMail: true, reason: stopMsg };
    }

    const providerEnv = agentState.model ? await getProviderEnvForModel(agentState.model) : {};
    if (agentState.model) {
      const provider = getProviderForModel(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuth(provider, agentState.workspace);
      } else {
        clearCredentialFileAuth(agentState.workspace);
      }
    }

    clearReadySignal(normalizedId);
    // Close any leftover pane or session unconditionally — closeAgentPane is a
    // no-op when there is none and never throws.
    await closeAgentPane(normalizedId);

    const providerExports = await getProviderExportsForModel(agentState.model || 'claude-sonnet-4-6');
    const fallbackLauncher = join(getAgentDir(normalizedId), 'launcher.sh');
    // PAN-1048 C4: resume must relaunch with the agent's actual role, not
    // hardcoded 'work'. A stopped review/test/ship run was previously
    // resurrected as a work agent because launcher generation ignored the
    // saved role. Use agentState.role and route through getRoleRuntimeBaseCommand
    // so the role-specific .claude/agents/* definition file is loaded.
    const resumeRole: Role = agentState.role ?? 'work';
    // PAN-1048 review feedback 006 (S1): Pi-backed resumes need the same
    // launcher fields the fresh-spawn path threads through generateLauncherScriptSync.
    // buildPiCommand throws on missing piSessionDir, so the previous fallback
    // emitted a launcher that would crash on resume for any Pi role agent.
    const resumeModel = agentState.model || 'claude-sonnet-4-6';
    const fallbackHarness = agentState.harness ?? 'claude-code';
    const harnessLaunch = await prepareHarnessLaunch(fallbackHarness);
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
      ? getCodexLauncherFields(normalizedId, resumeModel, agentState.workspace, resumeRole)
      : {};
    const fallbackSupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, resumeModel, fallbackHarness);
    const fallbackContent = generateLauncherScript({
      role: resumeRole,
      workingDir: agentState.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      extraEnvExports: [harnessLaunch.pathExport],
      baseCommand: await getRoleRuntimeBaseCommand(
        resumeModel,
        normalizedId,
        resumeRole,
        fallbackHarness,
      ),
      appendSystemPromptFiles: await claudeSystemPromptFiles(agentState.workspace, fallbackHarness),
      managedStateKey: normalizedId,
      overdeckEnv: {
        agentId: normalizedId,
        issueId: agentState.issueId,
        sessionType: resumeRole,
      },
      useSupervisor: fallbackSupervisorLaunch.useSupervisor,
      supervisorScriptPath: fallbackSupervisorLaunch.supervisorScriptPath,
      ...fallbackPiFields,
      ...fallbackCodexFields,
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    // PAN-3960: relaunch on the backend the host selects now, stamped like a spawn.
    const fallbackIssueId = agentState.issueId || normalizedId.replace(/^(agent|planning)-/, '').toUpperCase();
    const fallbackPane = await launchAgentPane({
      issueId: fallbackIssueId,
      cwd: agentState.workspace,
      agentId: normalizedId,
      argv: ['bash', fallbackLauncher],
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      },
      tokens: {
        issue: fallbackIssueId,
        role: toPaneRole(resumeRole),
        harness: fallbackHarness,
        model: resumeModel,
      },
    });
    agentState.backend = fallbackPane.backend;
    agentState.paneId = fallbackPane.paneId;

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    const ready = await waitForPromptReady(normalizedId, fallbackHarness, 30);
    const fallbackResumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    const resumeMessage = await buildResumeMessageForAgent(agentState, fallbackResumePrompt, message);
    let delivered = false;
    let reason: string | undefined;
    if (resumeMessage.error) {
      reason = resumeMessage.error;
      console.error(`[agents] Fallback-restarted ${normalizedId} but ${resumeMessage.error}`);
      emitActivityEntry({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId: agentState.issueId,
      });
    } else if (ready && resumeMessage.message) {
      if (fallbackHarness === 'claude-code') {
        const fallbackSessionId = getLatestSessionId(
          normalizedId,
          { getAgentState: () => agentState },
        );
        if (fallbackSessionId) {
          const delivery = await deliverMessageWithTranscriptConfirmation({
            agentId: normalizedId,
            workspace: agentState.workspace,
            sessionId: fallbackSessionId,
            message: resumeMessage.message,
            caller: 'resumeAgent:resume-prompt',
            deliveryMethod: resolveAgentDeliveryMethod(agentState),
          });
          delivered = delivery.delivered;
          if (!delivery.delivered) {
            reason = `resume prompt did not land after ${delivery.attempts} delivery attempts`;
            console.error(`[agents] Fallback resume prompt did not land after ${delivery.attempts} delivery attempts`);
          }
        } else {
          reason = 'no session id was recorded';
          console.error(`[agents] Fallback-restarted ${normalizedId} but no session id was recorded — feedback in mail queue`);
        }
      } else {
        const delivery = await deliverWithOptionalKey(normalizedId, resumeMessage.message, 'resumeAgent:resume-prompt', resolveAgentDeliveryMethod(agentState), opts.dedupKey);
        delivered = delivery.ok;
        if (!delivery.ok) reason = 'resume prompt delivery failed';
      }
      if (delivered) {
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
        await appendTellInterventionForUserSource(normalizedId, caller);
        console.log(`[agents] Fallback-restarted ${normalizedId} and delivered feedback`);
      }
    } else {
      reason = 'ready signal not detected';
      console.warn(`[agents] Fallback-restarted ${normalizedId} but ready signal not detected — feedback in mail queue`);
    }

    return { delivered, queuedToMail: true, ...(reason ? { reason } : {}) };
  }

  // Check if this is a remote agent
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('../remote/remote-agents.js');
  const remoteState = loadRemoteAgentState(normalizedId);
  if (remoteState && remoteState.vmName) {
    console.log(`[agents] Sending message to remote agent ${normalizedId} on ${remoteState.vmName}`);
    if (opts.dedupKey !== undefined) {
      // Keyed: the REMOTE tmux server is the crash-independent component and
      // enforces the key across the complete paste-settle-submit transaction
      // via the same two-phase marker protocol as the local tmux tier — a
      // dashboard crash mid-send replays into a dedup, never a second wake.
      const { sendToRemoteAgentKeyed } = await import('../remote/remote-agents.js');
      const remoteOutcome = await sendToRemoteAgentKeyed(normalizedId, remoteState.vmName, message, opts.dedupKey);
      // Durable backup (idempotent keyed filename); the remote agent never
      // drains the local mail dir, so this cannot replay.
      queueAgentMail(normalizedId, message, 'delivered', opts.dedupKey);
      await appendTellInterventionForUserSource(normalizedId, caller);
      return {
        delivered: true,
        queuedToMail: true,
        ...(remoteOutcome === 'deduplicated'
          ? { reason: 'deduplicated', deduplicated: true }
          : {}),
      };
    }
    await sendToRemoteAgent(normalizedId, remoteState.vmName, message);

    // Also save a durable backup of the delivered message.
    queueAgentMail(normalizedId, message, 'delivered');
    await appendTellInterventionForUserSource(normalizedId, caller);
    return { delivered: true, queuedToMail: true };
  }

  const expectedHarness = agentState?.harness ?? conversationHarness ?? 'claude-code';

  let appServerState: string | undefined;
  try {
    appServerState = (await getCodexAppServerStatus(normalizedId)).state;
  } catch {
    // A missing/unresponsive app-server means this target uses another
    // transport. Continue through the legacy tmux liveness path.
  }
  if (appServerState && appServerState !== 'closed' && appServerState !== 'error') {
    const promptReady = claimCodexIdleTurn(normalizedId);
    if (!promptReady) {
      // PAN-3736: a busy agent is a WORKING agent, not a dead one. Say that in
      // one phrase everywhere this outcome surfaces, and name the mail file so
      // a human or peer can read or hand-deliver it.
      //
      // PAN-3738: the file is `pending` mail whether or not the send is keyed.
      // The codex notify hook drains `*.pending.md` only, so a keyed message
      // named `dedup-<hash>.md` used to strand here forever — the keyed name
      // stays deterministic, it just carries the drainable suffix now.
      const mailPath = queueAgentMail(normalizedId, message, 'pending', opts.dedupKey);
      const busyReason = busyAgentQueuedReason(mailPath);
      logAgentLifecycle(normalizedId, `messageAgent: ${busyReason}`);
      console.log(`[agents] ${normalizedId}: ${busyReason}`);
      await appendTellInterventionForUserSource(normalizedId, caller);
      return { delivered: true, queuedToMail: true, reason: busyReason };
    }

    const deliveryMethod = resolveAgentDeliveryMethod(agentState);
    const delivery = await deliverWithOptionalKey(normalizedId, message, `messageAgent:${caller}`, deliveryMethod, opts.dedupKey);
    queueAgentMail(normalizedId, message, 'delivered', opts.dedupKey);
    await appendTellInterventionForUserSource(normalizedId, caller);
    return {
      delivered: delivery.ok,
      queuedToMail: true,
      ...(delivery.failure ? { reason: delivery.failure } : {}),
      ...(delivery.deduplicated ? { deduplicated: true } : {}),
    };
  }

  // Guard: if the tmux session exists but the harness process is gone (a
  // remain-on-exit dead shell), resume instead of typing the message into a
  // bare bash shell. Liveness is the single oracle (PAN-3849): session +
  // live pane + harness process in the pane's process subtree. Only a
  // CONFIRMED death takes the resume path — an indeterminate probe delivers
  // normally and lets the transport fail on its own rather than resuming a
  // possibly-healthy agent.
  // PAN-3879: a conversation has no agent state, so the oracle's default
  // harness reader would fall back to claude-code and report a live
  // acp-host/codex pane as runtime-missing. Probe with the harness the
  // conversation row declares.
  const liveness = await isAlive(normalizedId, { readHarness: () => expectedHarness });
  if (!liveness.alive && liveness.reason === 'no-session') {
    throw new Error(`Agent ${normalizedId} not running`);
  }
  // PAN-3849 + PAN-3879: the liveness oracle decides whether the pane is a
  // zombie (one module, and `runtime-indeterminate` is NOT death — a broken
  // probe must never trigger a resume). The conversation handling below is
  // PAN-3879's: resumeAgent requires agent state plus a resumable session
  // pointer and refuses conv- ids outright, so a conversation is never resumed.
  if (!liveness.alive && isConfirmedDead(liveness)) {
    if (isConversationTarget) {
      // For opencode/acp/codex the delivery door already routes by harness
      // (ACP fails loudly on a dead socket instead of typing into a dead
      // shell), so skip the zombie resume and hand off.
      if (expectedHarness === 'opencode' || expectedHarness === 'acp' || expectedHarness === 'codex') {
        console.warn(`[agents] ${normalizedId} pane shows no ${expectedHarness} runtime (${liveness.reason}) — skipping the zombie resume and handing off to the harness delivery door`);
        logAgentLifecycle(normalizedId, `messageAgent: pane shows no ${expectedHarness} runtime; handing off to the delivery door (conversations are never resumed, PAN-3879)`);
      } else {
        throw new Error(`Conversation ${normalizedId} tmux session is dead (no ${expectedHarness} runtime in its pane) and conversations cannot be resumed by pan tell — resume it from the dashboard, then send again.`);
      }
    } else {
      console.warn(`[agents] ${normalizedId} tmux session is a zombie (no ${expectedHarness} runtime) — attempting resume`);
      if (opts.dedupKey !== undefined) {
        return resumeThenDeliverKeyed(normalizedId, message, caller, agentState, opts.dedupKey);
      }
      const { resumeAgent } = await import('../agents.js');
      const resumeResult = await resumeAgent(normalizedId, message);
      if (resumeResult.success) {
        const delivered = resumeResult.messageDelivered !== false;
        if (delivered) {
          await appendTellInterventionForUserSource(normalizedId, caller);
        }
        return { delivered, queuedToMail: false };
      }
      throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
    }
  }

  // Codex's notify hook writes turn-completed at every idle boundary. Claiming
  // that marker makes the idle signal one-shot: the next message starts a turn,
  // and further messages queue until the hook reports the next completion.
  // Claude Code continues to use its hook-driven runtime mirror (PAN-1594).
  const promptReady = await waitForAgentIdle(normalizedId, 5000);
  if (!promptReady) {
    console.warn(`[agents] ${normalizedId} not at idle prompt after 5s — sending message anyway`);
  }

  const deliveryMethod = resolveAgentDeliveryMethod(agentState);
  const deliveryCaller = `messageAgent:${caller}`;
  const transcriptSessionId = getHarnessBehavior(expectedHarness).transcriptKind === 'claude-jsonl'
    ? getLatestSessionId(normalizedId, { getAgentState: () => agentState })
    : undefined;

  if (agentState?.workspace && transcriptSessionId && opts.dedupKey === undefined) {
    // Claude Code, unkeyed: deliver and wait for the transcript to show the turn.
    const confirmedDelivery = await deliverMessageWithTranscriptConfirmation({
      agentId: normalizedId,
      workspace: agentState.workspace,
      sessionId: transcriptSessionId,
      message,
      caller: deliveryCaller,
      // A supervisor-backed agent owns a verified PTY socket; require that path
      // instead of silently falling back to a tmux paste whose compaction
      // summary can masquerade as the message landing (same guard as resume).
      deliveryMethod: agentState.deliveryMethod === 'supervisor' || agentState.supervisorEnabled === true
        ? 'supervisor'
        : deliveryMethod,
    });
    queueAgentMail(normalizedId, message, 'delivered');
    await appendTellInterventionForUserSource(normalizedId, caller);
    if (!confirmedDelivery.delivered) {
      const reason = `message was injected but no turn appeared in transcript ${transcriptSessionId} within the confirmation window (${confirmedDelivery.attempts} attempts)`;
      logAgentLifecycle(normalizedId, `messageAgent NOT confirmed: ${reason}`);
      return { delivered: false, queuedToMail: true, confirmed: false, reason };
    }
    logAgentLifecycle(normalizedId, `messageAgent confirmed turn in ${transcriptSessionId} (caller: ${caller})`);
    return { delivered: true, queuedToMail: true, confirmed: true };
  }

  // Claude Code agent without an identifiable transcript: the confirmed-turn
  // contract (PAN-3846 FR-1) cannot be satisfied, so fail loudly instead of
  // falling through to an unconfirmed composer delivery that reports
  // delivered:true. Conversations (no agent state) and keyed or non-Claude
  // deliveries keep the composer-level contract below.
  if (agentState && getHarnessBehavior(expectedHarness).transcriptKind === 'claude-jsonl' && opts.dedupKey === undefined) {
    const reason = `cannot confirm delivery: no Claude transcript identifiable for ${normalizedId} (workspace: ${agentState.workspace ?? 'none'}, sessionId: ${transcriptSessionId ?? 'none'})`;
    logAgentLifecycle(normalizedId, `messageAgent NOT confirmed: ${reason}`);
    queueAgentMail(normalizedId, message, 'queued', undefined, caller);
    await appendTellInterventionForUserSource(normalizedId, caller);
    return { delivered: false, queuedToMail: true, confirmed: false, reason };
  }

  // Keyed deliveries and non-Claude harnesses keep the composer-level contract.
  const delivery = await deliverWithOptionalKey(
    normalizedId,
    message,
    deliveryCaller,
    deliveryMethod,
    opts.dedupKey,
  );

  // Save a durable backup. Unlike `.pending.md` busy-turn mail, the Codex hook
  // does not replay `.delivered.md` backups because they have already landed —
  // and the suffix says so to anyone reading `mail/` (PAN-3738).
  // Keyed deliveries skip the backup: the caller's outbox is the durable
  // receipt, and a keyed mail file is a replay channel — a monitor started
  // later would drain and print it as a second visible copy (cycle 7).
  if (opts.dedupKey === undefined) {
    queueAgentMail(normalizedId, message, 'delivered');
  }
  await appendTellInterventionForUserSource(normalizedId, caller);

  return {
    delivered: delivery.ok,
    queuedToMail: opts.dedupKey === undefined,
    confirmed: false,
    ...(delivery.failure ? { reason: delivery.failure } : {}),
    ...(delivery.deduplicated ? { deduplicated: true } : {}),
  };
}

export async function messageAgentWithOutcome(
  agentId: string,
  message: string,
  caller = 'internal',
  opts: MessageAgentRedriveOptions = {},
): Promise<MessageAgentOutcome> {
  const outcome = await messageAgent(agentId, message, caller, opts);
  return outcome.delivered ? 'delivered' : 'queued';
}
