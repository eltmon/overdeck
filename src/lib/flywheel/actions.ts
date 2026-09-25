/**
 * Flywheel actions (PAN-3964 FR-5, D4, D5).
 *
 * The CLI verbs and the `/api/flywheel/*` POST routes are both thin wrappers
 * over these functions. None of them writes a run record: start creates the
 * `conv-flywheel` conversation, pause/abort stop it through the ordinary
 * conversation stop path (session killed, row marked ended, transcript kept),
 * resume respawns it and re-sends `/pan-flywheel`, and report/stop ask the
 * loop itself to write `.pan/flywheel/report.md`.
 *
 * Every runtime dependency is injectable so the unit test needs no tmux, no
 * DB, and no harness.
 */

import { randomUUID } from 'node:crypto';

import type { LegacyConversation } from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';
import { FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_SKILL_COMMAND } from './constants.js';
import {
  readFlywheelRun,
  readFlywheelTranscript,
  resolveFlywheelProjectRoot,
  type DeriveFlywheelStatusDeps,
} from './derive-status.js';
import { FlywheelAlreadyRunning, FlywheelNotRunning, FlywheelOrphanSession, FlywheelPausedExists } from './errors.js';
import { readFlywheelReportFile, type FlywheelFilePayload } from './files.js';
import { findLastTick } from './tick-marker.js';

export const FLYWHEEL_REPORT_REQUEST =
  'Write your run report to .pan/flywheel/report.md now (what shipped, what is in flight, what is parked, substrate fixes this run), '
  + 'commit it with chore(workspace): flywheel report, then print flywheel-tick: … phase=watch and continue.';

export const FLYWHEEL_STOP_REQUEST =
  'Stop the loop: write .pan/flywheel/report.md, commit it, print flywheel-tick: … phase=stopping, then end.';

const FLYWHEEL_STOP_POLL_MS = 5_000;
const FLYWHEEL_STOP_DEFAULT_TIMEOUT_MS = 120_000;

export interface FlywheelStartOptions {
  model?: string;
  harness?: string;
  cwd?: string;
  /** Order book the flywheel should work from. Named in the opening prompt. */
  orders?: string;
  /** Replace a paused flywheel conversation instead of refusing (D5). */
  fresh?: boolean;
}

export interface FlywheelStartResult {
  session: string;
  harness: RuntimeName;
  model: string;
  prompt: string;
  cwd: string;
}

/** `{ status, body }` of the conversation handlers' JSON response. */
interface HandlerResult {
  status: number;
  error?: string;
  /** Resume found the harness already alive and only re-attached. */
  reattached?: boolean;
}

export interface FlywheelActionDeps extends Pick<
  DeriveFlywheelStatusDeps,
  'getConversation' | 'sessionAlive' | 'readTranscript' | 'resolveProjectPath' | 'resolvePlanHome'
> {
  /** Raw pane probe on the host backend — true even for a row-less orphan session. */
  tmuxSessionExists?: (session: string) => Promise<boolean>;
  killSession?: (session: string) => Promise<void>;
  resolveModelAndHarness?: (opts: { model?: string; harness?: string }) => Promise<{ model: string; harness: RuntimeName }>;
  createConversation?: (opts: {
    name: string; tmuxSession: string; cwd: string; claudeSessionId: string; title: string;
    titleSource: 'manual'; model: string; effort: string; harness: RuntimeName;
  }) => unknown;
  spawnSession?: (session: string, cwd: string, claudeSessionId: string, model: string, harness: RuntimeName) => Promise<void>;
  waitReady?: (session: string, harness: RuntimeName, mode: 'spawn' | 'respawn') => Promise<void>;
  /** Deliver a message (a slash command, a request) to the loop and submit it. */
  sendMessage?: (session: string, message: string, caller: string) => Promise<void>;
  stopConversation?: (name: string) => Promise<HandlerResult>;
  /** Undo a start that failed after its conversation row was written. */
  rollbackStart?: (name: string) => Promise<void>;
  resumeConversation?: (name: string) => Promise<HandlerResult>;
  readReport?: (planHome: string) => Promise<FlywheelFilePayload>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// ─── lazy defaults ───────────────────────────────────────────────────────────

async function defaultTmuxSessionExists(session: string): Promise<boolean> {
  const { conversationSessionAlive } = await import('../overdeck/conversation-liveness.js');
  return conversationSessionAlive(session);
}

async function defaultKillSession(session: string): Promise<void> {
  const { closeConversationPane } = await import('../overdeck/conversation-liveness.js');
  await closeConversationPane(session);
}

async function defaultResolveModelAndHarness(opts: { model?: string; harness?: string }): Promise<{ model: string; harness: RuntimeName }> {
  const [{ loadConfigSync }, { resolveModel }, { resolveHarness }] = await Promise.all([
    import('../config-yaml/load.js'),
    import('../config-yaml/roles.js'),
    import('../harness-resolve.js'),
  ]);
  const { config } = loadConfigSync();
  const model = opts.model ?? resolveModel('flywheel', undefined, config);
  const harness = await resolveHarness({ explicit: opts.harness as RuntimeName | undefined, role: 'flywheel', model });
  return { model, harness };
}

async function defaultCreateConversation(opts: Parameters<NonNullable<FlywheelActionDeps['createConversation']>>[0]): Promise<void> {
  const { createConversation } = await import('../overdeck/conversations.js');
  createConversation(opts);
}

async function defaultSpawnSession(session: string, cwd: string, claudeSessionId: string, model: string, harness: RuntimeName): Promise<void> {
  const runtime = await import('../overdeck/conversation-runtime.js');
  await runtime.spawnConversationSession(session, cwd, claudeSessionId, model, 'high', undefined, false, harness);
  await runtime.waitForTmuxSession(session);
}

async function defaultWaitReady(session: string, harness: RuntimeName, mode: 'spawn' | 'respawn'): Promise<void> {
  const { waitForConversationRuntimeReady } = await import('../overdeck/conversation-runtime.js');
  await waitForConversationRuntimeReady(session, harness, mode);
}

/** Through the delivery door, so the message reaches a Herdr pane or a tmux session alike (PAN-3921). */
async function defaultSendMessage(session: string, message: string, caller: string): Promise<void> {
  const { deliverAgentMessage } = await import('../agents.js');
  const delivery = await deliverAgentMessage(session, message, caller);
  if (!delivery.ok) throw new Error(`Flywheel message not delivered (${caller}): ${delivery.failure ?? delivery.path}`);
}

async function handlerResult(response: import('effect/unstable/http').HttpServerResponse.HttpServerResponse): Promise<HandlerResult> {
  try {
    const { HttpServerResponse } = await import('effect/unstable/http');
    const parsed = JSON.parse(await HttpServerResponse.toWeb(response).text()) as { error?: unknown; reattached?: unknown };
    return {
      status: response.status,
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
      ...(parsed.reattached === true ? { reattached: true } : {}),
    };
  } catch {
    return { status: response.status };
  }
}

async function defaultStopConversation(name: string): Promise<HandlerResult> {
  const { handleConversationStop } = await import('../overdeck/conversation-runtime.js');
  return handlerResult(await handleConversationStop(name, {}));
}

async function defaultResumeConversation(name: string): Promise<HandlerResult> {
  const [{ handleConversationResume }, { resolveSessionFile }] = await Promise.all([
    import('../overdeck/conversation-runtime.js'),
    import('../overdeck/conversation-reads.js'),
  ]);
  // The resume contract would start a turn; the loop re-orients from
  // `/pan-flywheel` instead, so skip it and send the skill below.
  return handlerResult(await handleConversationResume(name, { sendResumeContract: false }, { resolveSessionFile }));
}

async function defaultRollbackStart(name: string): Promise<void> {
  const [{ getConversationByName, markConversationEnded, archiveConversation }, { stopConversationRuntime }] = await Promise.all([
    import('../overdeck/conversations.js'),
    import('../overdeck/conversation-runtime.js'),
  ]);
  const conv = getConversationByName(name);
  if (conv) await stopConversationRuntime(conv, name);
  markConversationEnded(name);
  archiveConversation(name);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── actions ─────────────────────────────────────────────────────────────────

async function requireRunning(deps: FlywheelActionDeps): Promise<LegacyConversation> {
  const { conv, run } = await readFlywheelRun(deps);
  if (run !== 'running' || !conv) throw new FlywheelNotRunning();
  return conv;
}

export async function startFlywheel(opts: FlywheelStartOptions = {}, deps: FlywheelActionDeps = {}): Promise<FlywheelStartResult> {
  const { run } = await readFlywheelRun(deps);
  if (run === 'running') throw new FlywheelAlreadyRunning();
  if (run === 'paused' && !opts.fresh) throw new FlywheelPausedExists();
  const orphanSession = await (deps.tmuxSessionExists ?? defaultTmuxSessionExists)(FLYWHEEL_CONVERSATION_SESSION);
  if (orphanSession) {
    // A session without a running row: an ended row whose idle harness stayed
    // up (paused + --fresh), or a row-less orphan. Only --fresh may replace it.
    if (!opts.fresh) throw new FlywheelOrphanSession();
    await (deps.killSession ?? defaultKillSession)(FLYWHEEL_CONVERSATION_SESSION);
  }

  const cwd = opts.cwd ?? process.cwd();
  const { model, harness } = await (deps.resolveModelAndHarness ?? defaultResolveModelAndHarness)(opts);

  // Register the conversation before the session exists, so the dashboard's
  // conversation list sees it the moment it comes up. An operator
  // conversation carries no `issue` token.
  const claudeSessionId = randomUUID();
  await (deps.createConversation ?? defaultCreateConversation)({
    name: FLYWHEEL_CONVERSATION_SESSION,
    tmuxSession: FLYWHEEL_CONVERSATION_SESSION,
    cwd,
    claudeSessionId,
    title: 'Flywheel',
    titleSource: 'manual',
    model,
    effort: 'high',
    harness,
  });

  // The loop is the skill. Hand it the slash command and let it run.
  const prompt = opts.orders ? `${FLYWHEEL_SKILL_COMMAND} ${opts.orders}` : FLYWHEEL_SKILL_COMMAND;
  try {
    await (deps.spawnSession ?? defaultSpawnSession)(FLYWHEEL_CONVERSATION_SESSION, cwd, claudeSessionId, model, harness);
    await (deps.waitReady ?? defaultWaitReady)(FLYWHEEL_CONVERSATION_SESSION, harness, 'spawn');
    await (deps.sendMessage ?? defaultSendMessage)(FLYWHEEL_CONVERSATION_SESSION, prompt, 'pan flywheel start');
  } catch (error) {
    // A start that never reached the loop must not leave a row that reads as
    // `paused` (which would demand --fresh) or a half-started session.
    await (deps.rollbackStart ?? defaultRollbackStart)(FLYWHEEL_CONVERSATION_SESSION).catch((rollbackError: unknown) => {
      console.warn('[flywheel] start rollback failed:', rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    });
    throw error;
  }

  return { session: FLYWHEEL_CONVERSATION_SESSION, harness, model, prompt, cwd };
}

/** D4: stop the session, keep the row and the transcript. */
export async function pauseFlywheel(deps: FlywheelActionDeps = {}): Promise<void> {
  const result = await (deps.stopConversation ?? defaultStopConversation)(FLYWHEEL_CONVERSATION_SESSION);
  if (result.status === 404) throw new FlywheelNotRunning('No flywheel conversation exists');
  if (result.status >= 400) throw new Error(result.error ?? `Failed to stop the flywheel (${result.status})`);
}

/** Pause without asking for a report. */
export async function abortFlywheel(deps: FlywheelActionDeps = {}): Promise<void> {
  await pauseFlywheel(deps);
}

/** D4: respawn the paused conversation and re-send the skill. */
export async function resumeFlywheel(deps: FlywheelActionDeps = {}): Promise<{ session: string }> {
  const { run } = await readFlywheelRun(deps);
  if (run === 'running') throw new FlywheelAlreadyRunning();
  if (run === 'idle') throw new FlywheelNotRunning('No flywheel conversation to resume — `pan flywheel start`');
  const result = await (deps.resumeConversation ?? defaultResumeConversation)(FLYWHEEL_CONVERSATION_SESSION);
  if (result.status === 404) throw new FlywheelNotRunning('No flywheel conversation to resume — `pan flywheel start`');
  if (result.status >= 400) throw new Error(result.error ?? `Failed to resume the flywheel (${result.status})`);
  // The harness was already alive (the loop is still running its turn):
  // re-sending the skill would queue a second `/pan-flywheel` into it.
  if (result.reattached) return { session: FLYWHEEL_CONVERSATION_SESSION };
  await (deps.sendMessage ?? defaultSendMessage)(FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_SKILL_COMMAND, 'pan flywheel resume');
  return { session: FLYWHEEL_CONVERSATION_SESSION };
}

/** Ask the running loop to write and commit its report, then continue. */
export async function requestFlywheelReport(deps: FlywheelActionDeps = {}): Promise<void> {
  await requireRunning(deps);
  await (deps.sendMessage ?? defaultSendMessage)(FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_REPORT_REQUEST, 'pan flywheel report');
}

/**
 * Graceful stop: ask the loop to write, commit, and push its report, then
 * poll every 5 s for the loop's `phase=stopping` tick newer than the request
 * — the skill prints it only after the commit and push, so pausing earlier
 * could kill the session mid-commit. On timeout it pauses anyway.
 * `reportWritten` is whether `report.md` (read from the same plan home the
 * page and `pan flywheel report` read) was modified after the request.
 */
export async function stopFlywheel(
  opts: { timeoutMs?: number } = {},
  deps: FlywheelActionDeps = {},
): Promise<{ reportWritten: boolean; stopped: boolean }> {
  const conv = await requireRunning(deps);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const readReport = deps.readReport ?? readFlywheelReportFile;
  const readTranscript = deps.readTranscript ?? readFlywheelTranscript;
  const { planHome } = await resolveFlywheelProjectRoot({ deps: { ...deps, getConversation: () => conv } });
  const timeoutMs = opts.timeoutMs ?? FLYWHEEL_STOP_DEFAULT_TIMEOUT_MS;

  const requestedAt = now();
  await (deps.sendMessage ?? defaultSendMessage)(FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_STOP_REQUEST, 'pan flywheel stop');

  let stopped = false;
  while (now() - requestedAt < timeoutMs) {
    await sleep(Math.min(FLYWHEEL_STOP_POLL_MS, Math.max(0, timeoutMs - (now() - requestedAt))));
    const tick = findLastTick(await readTranscript(conv).catch(() => []));
    if (tick && tick.phase === 'stopping' && Date.parse(tick.at) > requestedAt) {
      stopped = true;
      break;
    }
  }

  const report = await readReport(planHome).catch(() => null);
  const modified = report?.lastModified ? Date.parse(report.lastModified) : Number.NaN;
  await pauseFlywheel(deps);
  return { reportWritten: Number.isFinite(modified) && modified > requestedAt, stopped };
}
