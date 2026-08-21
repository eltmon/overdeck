import { randomUUID } from 'node:crypto';
import { exec, execFile } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile, readdir, stat, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { MODEL_ID_PATTERN } from '../model-validation.js';
import { getClaudePermissionFlagsStringSync, ensureClaudePermissionFlagSync } from '../claude-permissions.js';
import { listProjectsAsync, type ProjectConfig } from '../projects.js';
import { getDefaultCwd } from '../default-cwd.js';
import {
  listConversations,
  getConversationByName,
  createConversation,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
  setConversationModel,
  setConversationHarness,
  backfillConversationModel,
  archiveConversation,
  removeFavorite,
  updateSpawnError,
  clearConversationFailureState,
  hasOtherActiveConversationOnTmuxSession,
  type LegacyConversation as Conversation,
} from './conversations.js';
import {
  capturePane,
  capturePaneText,
  sessionExists,
  isHarnessProcessAlive,
  killSession,
  createSession,
  setOption,
  exactPaneTarget,
  listSessionNames,
  findManagedServerPidSync,
} from '../tmux.js';
import { deliverAgentMessage, writeChannelsBridgeMcpConfig, dismissDevChannelsDialog, waitForReadySignal, clearReadySignal } from '../agents.js';
import {
  getAgentRuntimeBaseCommand,
  getProviderExportsForModel,
  getProviderAuthMode,
} from '../agents.js';
import { writeBridgeTokenSync } from '../bridge-token.js';
import { isClaudeCodeChannelsEnabled, loadConfigSync } from '../config-yaml.js';
import { writePtyToken } from '../pty-token.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { resolveHarness } from '../harness-resolve.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { getProviderForModelSync, piProviderForModel, UnknownModelError } from '../providers.js';
import { getOhmypiCodexAuthStatus } from '../ohmypi-codex-auth.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { piFifoPaths } from '../runtimes/pi-fifo.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getAcpLauncherFields, waitForAcpHostReady, waitForPromptReady } from '../agents/runtime-command.js';
import { workspaceContextFile, piGlobalContextFile } from '../context-layers/layers.js';
import { ensureSessionContextBriefingFile } from '../briefing-freshness.js';
import { sessionFilePath, getOverdeckHome, resolveOhmypiExtensionPath } from '../paths.js';
import { resolvePtySupervisorScriptPath } from '../channels/pty-supervisor-locate.js';
import { buildResumeContract } from '../resume-contract.js';
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { getEventStore } from '../../dashboard/server/event-store.js';
import { markRespawnPending } from '../../dashboard/server/services/pending-respawn.js';
import { cleanupConversationAttachments, cleanupUnreferencedConversationAttachments } from '../../dashboard/server/services/conversation-attachments.js';
import { resolveCodexRolloutPath } from '../../dashboard/server/routes/jsonl-resolver.js';
import { sendConversationControlCommand, isPiControlChannelHarness, resolveConversationDeliveryMethod } from './conversation-delivery.js';
import { deliverResumeContractUnlessGated } from './resume-contract-delivery.js';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const PROCESS_CLEANUP_GRACE_MS = 750;
const PTY_SUPERVISOR_SOCKET_WAIT_MS = 30_000;
type ProcessTableRow = {
  pid: number;
  ppid: number;
  args: string;
};
function parseProcessTable(output: string): ProcessTableRow[] {
  return output
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        args: match[3] ?? '',
      };
    })
    .filter((row): row is ProcessTableRow => row !== null && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}
async function readProcessTable(): Promise<ProcessTableRow[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,args='], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseProcessTable(stdout);
}
function collectProcessTree(rootPids: number[], rows: ProcessTableRow[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.ppid, children);
  }
  const seen = new Set<number>();
  const ordered: number[] = [];
  const visit = (pid: number) => {
    if (seen.has(pid) || pid === process.pid) return;
    seen.add(pid);
    for (const child of childrenByParent.get(pid) ?? []) visit(child);
    ordered.push(pid);
  };
  for (const pid of rootPids) visit(pid);
  return ordered;
}
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function terminatePids(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
    }
  }
  await new Promise((resolve) => setTimeout(resolve, PROCESS_CLEANUP_GRACE_MS));
  for (const pid of pids) {
    if (!isProcessAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
    }
  }
}
export function conversationRuntimeRootPids(conv: Conversation, rows: ProcessTableRow[]): number[] {
  const launcherScript = join(getOverdeckHome(), 'conversations', conv.tmuxSession, 'launcher.sh');
  const sessionId = conv.claudeSessionId?.trim();
  const sessionNeedles = sessionId ? [`--resume ${sessionId}`, `--session-id ${sessionId}`] : [];
  const serverPid = findManagedServerPidSync();
  return rows
    .filter((row) => {
      if (row.pid === process.pid) return false;
      if (serverPid !== undefined && row.pid === serverPid) return false;
      if (row.args.includes(launcherScript)) return true;
      return sessionNeedles.some((needle) => row.args.includes(needle));
    })
    .map((row) => row.pid);
}
async function killConversationRuntimeProcesses(conv: Conversation): Promise<void> {
  const rows = await readProcessTable();
  const rootPids = conversationRuntimeRootPids(conv, rows);
  const pids = collectProcessTree(rootPids, rows);
  await terminatePids(pids);
}
export async function stopConversationRuntime(conv: Conversation, name: string): Promise<void> {
  if (hasOtherActiveConversationOnTmuxSession(conv.tmuxSession, name)) {
    return;
  }
  await Effect.runPromise(killSession(conv.tmuxSession).pipe(Effect.catch(() => Effect.succeed(undefined))));
  try {
    await killConversationRuntimeProcesses(conv);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[conversations] failed to cleanup runtime processes for ${name}: ${msg}`);
  }
}
/** Quote a string for safe use in a bash script using single-quote wrapping. */
function shellQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\"'\"'") + "'";
}
// Canonical model-id shape lives in model-validation.ts — it permits the
// square-bracket context suffix (e.g. `k3[1m]`) that a local copy of this
// pattern once rejected (PAN-2979). Shell safety comes from single-quote
// wrapping at the launcher, not from this character set.
const SAFE_MODEL_PATTERN = MODEL_ID_PATTERN;
const SAFE_EFFORT_PATTERN = /^(low|medium|high)$/;
const SAFE_ISSUE_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;
const PI_CONVERSATION_SOURCE_CONTRACT = [
  'Pi conversation source contract:',
  "A message marked source:'extension' was injected by the Overdeck orchestrator or another agent, not typed by the human operator.",
  'Treat it as coordination guidance; do not attribute it to the human operator.',
].join(' ');
export async function resolveAllowedHarness(requested: unknown, model?: string | null): Promise<RuntimeName> {
  if (!model) return 'claude-code';
  const explicit: RuntimeName | undefined =
    requested === 'ohmypi' || requested === 'claude-code' || requested === 'codex' || requested === 'acp' || requested === 'kimi-code'
      ? requested
      : undefined;
  return resolveHarness({ model, explicit });
}
export async function isInsideGitWorkTree(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir, encoding: 'utf-8' });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}
async function validateCwdContainment(cwd: string): Promise<boolean> {
  if (!cwd.startsWith('/')) return false;
  const segments = cwd.split('/').filter(Boolean);
  if (segments.includes('..')) return false;
  try {
    const resolved = await realpath(cwd);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return false;
    const home = homedir();
    return resolved.startsWith(`${home}/`) || resolved === home;
  } catch {
    return false;
  }
}
async function waitForClaudeReady(tmuxSession: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const output = await Effect.runPromise(capturePane(tmuxSession, 200));
    if (output.includes('❯')) {
      console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession}`);
}
function isPiTuiInputReady(snapshot: string): boolean {
  // omp v17 renders its footer before MCP startup completes, but input sent
  // during that transition is discarded by the final TUI redraw. When MCP
  // connection is visible, wait for its completion message before delivery.
  if (/Connecting to MCP servers/i.test(snapshot) && !/MCP finished/i.test(snapshot)) {
    return false;
  }
  return /^\s*[❯›>]\s/m.test(snapshot)
    || /(?:^|\s)0(?:\.\d+)?%\s+context\s+used\b/i.test(snapshot)
    // Current omp/Pi footer bar, e.g. "╭── π  > ⬢ Qwen3.6 Plus · ◕ high > ...".
    // It renders within ~1s of spawn. Once any visible MCP startup has completed,
    // it signals that Pi's TUI is accepting input. The two patterns
    // above matched an older Pi build's chrome and no longer appear at all, which
    // is why this check previously ran to its full timeout on every ohmypi spawn.
    || /⬢[^\n]*[◕◉]/.test(snapshot);
}
export async function waitForPiTuiReady(tmuxSession: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await Effect.runPromise(
      capturePane(tmuxSession, 40).pipe(Effect.catch(() => Effect.succeed(''))),
    );
    if (isPiTuiInputReady(snapshot)) {
      console.log(`[conversations] Pi TUI ready for ${tmuxSession}`);
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  console.warn(`[conversations] Timed out waiting for Pi TUI to render in ${tmuxSession}`);
  return false;
}
export function shouldReportUnresolvedLiveSession(
  conv: Pick<Conversation, 'status' | 'harness'> | null | undefined,
): boolean {
  if (!conv || conv.status !== 'active') return false;
  return getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl';
}

export function conversationSessionAliveFromState(
  conv: Pick<Conversation, 'status' | 'forkStatus'>,
  tmuxSessionAlive: boolean,
): boolean {
  return conv.status === 'active' && !conv.forkStatus && tmuxSessionAlive;
}

export function conversationNeedsRunningRepair(
  conv: Pick<Conversation, 'status' | 'forkStatus'>,
  tmuxSessionAlive: boolean,
  harnessProcessAlive: boolean,
): boolean {
  return conv.status === 'ended' && !conv.forkStatus && tmuxSessionAlive && harnessProcessAlive;
}
/** Generate a default conversation name, e.g. 20260404-1234 */
function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${Math.floor(Math.random() * 9000 + 1000)}`;
}
/** Sanitize a user-provided name to be safe for tmux session names */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}
export async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  return Effect.runPromise(sessionExists(sessionName));
}
export async function waitForTmuxSession(sessionName: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await Effect.runPromise(sessionExists(sessionName))) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for tmux session ${sessionName}`);
}
export function shouldUseSupervisorForConversation(
  harness: RuntimeName,
  options: { codexTransport?: 'app-server' | 'tui' } = {},
): boolean {
  if (harness === 'codex' && options.codexTransport === 'app-server') return false;
  return getHarnessBehavior(harness).supportsPtySupervisor && process.env.OVERDECK_DOCKER_WORKSPACE !== '1' && process.env.PAN_DOCKER !== '1';
}
export async function waitForConversationRuntimeReady(tmuxSession: string, harness: RuntimeName, mode: 'spawn' | 'respawn'): Promise<void> {
  if (harness === 'acp') {
    await waitForAcpHostReady(tmuxSession);
    return;
  }
  const transcriptKind = getHarnessBehavior(harness).transcriptKind;
  if (transcriptKind === 'ohmypi-jsonl') {
    const ready = await waitForPiTuiReady(tmuxSession);
    if (!ready) {
      throw new Error(
        `Pi (ohmypi) did not become interactive in ${tmuxSession} within the startup window — MCP server connections are likely still in progress. Retry once MCP servers finish connecting, or check ~/.claude/mcp.json for a slow/hanging server.`,
      );
    }
  }
  else if (transcriptKind === 'kimi-wire-jsonl') {
    // PAN-1837 review fix: this readiness dispatcher had no Kimi branch, so it
    // fell through to waitForClaudeReady() and waited for Claude Code's own
    // ready markers, which the native kimi binary never produces.
    const ready = await waitForPromptReady(tmuxSession, 'kimi-code', 30);
    if (!ready) {
      throw new Error(`Kimi Code did not become interactive in ${tmuxSession} within the startup window.`);
    }
  }
  else if (transcriptKind !== 'codex-rollout-jsonl' && mode === 'spawn') {
    await waitForClaudeReady(tmuxSession);
    console.log(`[conversations] Claude ready in ${tmuxSession}`);
  } else if (transcriptKind !== 'codex-rollout-jsonl') await waitForReadySignal(tmuxSession, 30);
}
export async function handleConversationSwitchModel(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }
  const model = typeof body['model'] === 'string' && body['model'].trim()
    ? body['model'].trim()
    : (conv.model ?? undefined);
  const currentHarness: RuntimeName = conv.harness ?? 'claude-code';
  const requestedHarness = body['harness'];
  let harness: RuntimeName = currentHarness;
  if (requestedHarness === 'ohmypi' || requestedHarness === 'pi' || requestedHarness === 'claude-code' || requestedHarness === 'codex' || requestedHarness === 'acp' || requestedHarness === 'kimi-code') {
    const requestedRuntime: RuntimeName = requestedHarness === 'pi' ? 'ohmypi' : requestedHarness;
    if (requestedRuntime !== currentHarness) {
      const policyModel = model ?? conv.model ?? '';
      const decision = canUseHarnessSync(
        requestedRuntime,
        policyModel,
        await getProviderAuthMode(policyModel),
      );
      if (!decision.allowed) {
        return jsonResponse(
          { error: decision.reason ?? 'Harness not allowed for this model' },
          { status: 400 },
        );
      }
    }
    harness = requestedRuntime;
  }
  const harnessChanged = harness !== currentHarness;
  if (!(await validateCwdContainment(conv.cwd))) {
    return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
  }
  if (model && !SAFE_MODEL_PATTERN.test(model)) {
    return jsonResponse({ error: 'Invalid model' }, { status: 400 });
  }
  const livePiSwitch = isPiControlChannelHarness(currentHarness) && conv.status !== 'ended';
  if (conv.claudeSessionId && harnessChanged) {
    return jsonResponse(
      { error: 'Conversation harness is locked once a conversation has started' },
      { status: 409 },
    );
  }
  if (conv.claudeSessionId && !livePiSwitch) {
    return jsonResponse(
      { error: 'Conversation model is locked once a conversation has started' },
      { status: 409 },
    );
  }
  if (model) {
    if (livePiSwitch) {
      await sendConversationControlCommand(conv, { type: 'set_model', model });
    }
    setConversationModel(name, model);
  }
  if (harnessChanged) setConversationHarness(name, harness);
  const updated = getConversationByName(name) ?? conv;
  return jsonResponse({
    ...updated,
    model: model ?? updated.model,
    harness,
    sessionAlive: false,
  });
}
function getPtySupervisorSocketPath(agentId: string): string {
  return join(getOverdeckHome(), 'sockets', `pty-${agentId}.sock`);
}
/**
 * Pull the supervisor's own failure out of the tmux pane it died in.
 *
 * A supervisor that cannot load its native node-pty exits instantly with an
 * ERR_MODULE_NOT_FOUND on stderr; all the spawn path sees is the socket that
 * never appeared. Reporting only the timeout hides the actual cause and sent
 * an operator hunting the memory governor instead (PAN-3172).
 */
export function extractSupervisorFailure(paneText: string): string | null {
  const lines = paneText.split('\n').map((line) => line.trim()).filter(Boolean);
  const errors = lines.filter((line) => /error|cannot find|ERR_[A-Z_]+|pty-supervisor:/i.test(line));
  const chosen = errors.slice(-3);
  if (chosen.length === 0) return null;
  return chosen.join(' | ').slice(0, 500);
}

export async function waitForPtySupervisorSocket(agentId: string, timeoutMs = PTY_SUPERVISOR_SOCKET_WAIT_MS): Promise<void> {
  const socketPath = getPtySupervisorSocketPath(agentId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await stat(socketPath);
      if ((info.mode & 0o777) === 0o600) return;
    } catch {
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const failure = extractSupervisorFailure(await capturePaneText(agentId, 40));
  const detail = failure ? `supervisor output: ${failure}` : 'the supervisor pane shows no error output (a healthy harness statusline); the supervisor may have bound its socket under a different OVERDECK_HOME';
  throw new Error(`Timed out waiting for PTY supervisor socket ${socketPath} — ${detail}`);
}
export async function waitForPtySupervisorOrFallback(
  agentId: string,
  timeoutMs = PTY_SUPERVISOR_SOCKET_WAIT_MS,
  sessionAlive: (name: string) => Promise<boolean> = tmuxSessionExists,
): Promise<void> {
  try {
    await waitForPtySupervisorSocket(agentId, timeoutMs);
  } catch (error) {
    if (!await sessionAlive(agentId)) throw error;
    console.warn(
      `[conversations] PTY supervisor socket unavailable for ${agentId}; `
      + `continuing with fallback delivery: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function extractModelFromSessionFile(sessionFile: string): Promise<string | null> {
  try {
    if (!existsSync(sessionFile)) return null;
    const stream = createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.type === 'assistant' && entry.message?.model) {
          return entry.message.model as string;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  } catch {
  }
  return null;
}
let backfillRunning = false;
export async function backfillConversationModels(resolveSessionFile: (conv: Conversation) => Promise<string | null>): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    const convs = listConversations();
    const probe = await Promise.all(
      convs.map(async (conv) => (!conv.model ? await resolveSessionFile(conv) : null)),
    );
    const candidates = convs.filter((_, i) => probe[i] !== null);
    const BATCH_SIZE = 10;
    let backfilled = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (conv) => {
          const sessionFile = await resolveSessionFile(conv);
          if (!sessionFile) return false;
          const model = await extractModelFromSessionFile(sessionFile);
          if (model && SAFE_MODEL_PATTERN.test(model)) {
            backfillConversationModel(conv.name, model);
            return true;
          }
          return false;
        }),
      );
      backfilled += results.filter(Boolean).length;
    }
    if (backfilled > 0) {
      console.log(`[conversations] Backfilled model for ${backfilled} conversation(s)`);
    }
  } finally {
    backfillRunning = false;
  }
}
export function startConversationModelBackfill(resolveSessionFile: (conv: Conversation) => Promise<string | null>): void {
  void backfillConversationModels(resolveSessionFile).catch((err: unknown) => {
    console.error('[conversations] Model backfill failed:', err);
  });
}
async function claudeConversationSystemPromptFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(cwd);
  try {
    await stat(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());
  return files;
}
async function ensurePiConversationSourceContractFile(): Promise<string> {
  const contextDir = join(getOverdeckHome(), 'context');
  await mkdir(contextDir, { recursive: true });
  const path = join(contextDir, 'pi-conversation-source-contract.md');
  await writeFile(path, `${PI_CONVERSATION_SOURCE_CONTRACT}\n`, 'utf-8');
  return path;
}
export async function piConversationSystemPromptFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const globalFile = piGlobalContextFile();
  try {
    await stat(globalFile);
    files.push(globalFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensurePiConversationSourceContractFile());
  const contextFile = workspaceContextFile(cwd);
  try {
    await stat(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());
  return files;
}
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
export async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  claudeSessionId: string,
  model?: string,
  effort?: string,
  issueId?: string,
  resume = false,
  harness: RuntimeName = 'claude-code',
  plainFork = false,
): Promise<void> {
  const behavior = getHarnessBehavior(harness);
  const harnessLaunch = await prepareHarnessLaunch(harness);
  const stateDir = join(getOverdeckHome(), 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });
  clearReadySignal(tmuxSession);
  const launcherScript = join(stateDir, 'launcher.sh');
  const permissionFlags = getClaudePermissionFlagsStringSync();
  let runtimeCommand = `claude ${permissionFlags}`;
  let providerExportsStr = '';
  let piFields: {
    harness: 'ohmypi';
    piMode: 'tui';
    piExtensionPath: string;
    piSessionDir: string;
    resumeSessionId?: string;
  } | undefined;
  let codexFields: {
    harness: 'codex';
    codexMode: 'app-server' | 'tui';
    codexHome: string;
    codexSessionDir: string;
    resumeSessionId?: string;
  } | undefined;
  let acpFields: (ReturnType<typeof getAcpLauncherFields> & { resumeSessionId?: string }) | undefined;
  let kimiCodeFields: { harness: 'kimi-code'; kimiCodeModel: string; kimiCodeYolo: true; resumeSessionId?: string } | undefined;
  let codexTransport: 'app-server' | 'tui' | undefined;
  if (behavior.launchCommandKind === 'acp-host') {
    if (!model) throw new Error('ACP conversation requires a model');
    if (!SAFE_MODEL_PATTERN.test(model)) throw new Error('Invalid model name');
    const sessionIdPath = join(getOverdeckHome(), 'agents', tmuxSession, 'acp-session-id');
    const resumeSessionId = resume
      ? await readFile(sessionIdPath, 'utf-8').then((value) => value.trim() || undefined).catch(() => undefined)
      : undefined;
    await rm(sessionIdPath, { force: true }); // PAN-3357: not a dir removal
    acpFields = {
      ...getAcpLauncherFields(tmuxSession, model, cwd, harnessLaunch.binaryPath, 'work'),
      resumeSessionId,
    };
    runtimeCommand = 'acp-host';
  } else if (model) {
    if (!SAFE_MODEL_PATTERN.test(model)) {
      throw new Error('Invalid model name');
    }
    runtimeCommand = await getAgentRuntimeBaseCommand(model, undefined, undefined, harness);
    // The mode→flag mapping lives in claude-permissions.ts. The inline ternary
    // that used to live here emitted the literal value `auto` under
    // claude.permissionMode=auto, which Claude Code strict-validates and rejects.
    runtimeCommand = ensureClaudePermissionFlagSync(runtimeCommand);
    providerExportsStr = (await getProviderExportsForModel(model, harness)).trim();
    if (behavior.transcriptKind === 'ohmypi-jsonl') {
      if (getProviderForModelSync(model).name === 'openai') {
        const auth = await getOhmypiCodexAuthStatus({ refreshIfExpired: true });
        if (auth.status === 'missing' || auth.status === 'expired') {
          throw new Error(
            'ohmypi ChatGPT/Codex login (openai-codex) has expired and could not be refreshed. ' +
            'Re-authenticate with `pan pi-auth login`, then retry.',
          );
        }
      }
      const paths = piFifoPaths(tmuxSession);
      const piSessionDir = join(paths.agentDir, 'sessions');
      await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
      await mkdir(piSessionDir, { recursive: true, mode: 0o700 });
      const storedPiSessionId = resume
        ? (await readFile(join(paths.agentDir, 'session.id'), 'utf-8').then((s) => s.trim()).catch(() => undefined))
        : undefined;
      piFields = {
        harness: 'ohmypi',
        piMode: 'tui',
        piExtensionPath: resolveOhmypiExtensionPath() ?? resolve(process.cwd(), 'packages/ohmypi-extension/dist/index.js'),
        piSessionDir,
        resumeSessionId: storedPiSessionId || undefined,
      };
    } else if (behavior.usesCodexHome) {
      const codexHome = join(getOverdeckHome(), 'agents', tmuxSession, 'codex-home');
      const codexConfig = loadConfigSync().config.codex;
      const codexPermMode = codexConfig?.permissionMode ?? 'workspace';
      codexTransport = codexConfig?.transport ?? 'app-server';
      const codexApprovalPolicy = codexPermMode === 'full-access' ? 'never' : 'on-request';
      const codexSandboxMode =
        codexPermMode === 'full-access' ? 'danger-full-access'
        : codexPermMode === 'read-only' ? 'read-only'
        : 'workspace-write';
      const codexApprovalsReviewer = codexPermMode === 'auto-review' ? 'auto_review' : undefined;
      const { initCodexHome, extractThreadIdFromRollout } = await import('../runtimes/codex.js');
      initCodexHome(codexHome, {
        trustedDir: cwd,
        approvalPolicy: codexApprovalPolicy,
        sandboxMode: codexSandboxMode,
        approvalsReviewer: codexApprovalsReviewer,
      });
      const resumeSessionId = resume
        ? await resolveCodexRolloutPath(tmuxSession, { agentsDirOverride: join(getOverdeckHome(), 'agents') })
          .then((rollout) => rollout ? extractThreadIdFromRollout(rollout) ?? undefined : undefined)
        : undefined;
      codexFields = {
        harness: 'codex',
        codexMode: codexTransport,
        codexHome,
        codexSessionDir: join(codexHome, 'sessions'),
        resumeSessionId,
      };
    } else if (behavior.launchCommandKind === 'kimi-code-tui') {
      // PAN-1837 review fix: read the persisted kimi-session-id when resuming
      // so a stopped Kimi conversation actually resumes its native session
      // (-S <id>) instead of always launching fresh and silently overwriting
      // the pinned transcript pointer with a brand-new session directory.
      // Verify the pinned wire.jsonl still exists on disk before trusting the
      // id — if it was cleaned up, fall through to the fresh-launch path
      // (kimiExistingSessionsBefore capture below) instead of resuming a
      // session Kimi can no longer find.
      let kimiResumeSessionId: string | undefined;
      if (resume) {
        const kimiSessionIdPath = join(getOverdeckHome(), 'agents', tmuxSession, 'kimi-session-id');
        const pinnedId = await readFile(kimiSessionIdPath, 'utf-8').then((value) => value.trim() || undefined).catch(() => undefined);
        if (pinnedId) {
          const { kimiSessionsRoot } = await import('../runtimes/kimi-code.js');
          const candidateWire = join(kimiSessionsRoot(join(homedir(), '.kimi-code'), cwd), pinnedId, 'agents', 'main', 'wire.jsonl');
          const wireExists = await stat(candidateWire).then(() => true, () => false);
          if (wireExists) kimiResumeSessionId = pinnedId;
        }
      }
      kimiCodeFields = {
        harness: 'kimi-code',
        kimiCodeModel: model,
        kimiCodeYolo: true,
        ...(kimiResumeSessionId ? { resumeSessionId: kimiResumeSessionId } : {}),
      };
    }
  }
  let launcherModel = model;
  if (behavior.contextLayerKind === 'pi' && model) {
    const piProvider = piProviderForModel(model);
    if (piProvider) launcherModel = `${piProvider}/${model}`;
  }
  if (effort && !SAFE_EFFORT_PATTERN.test(effort)) {
    throw new Error('Invalid effort level');
  }
  const useSupervisor = shouldUseSupervisorForConversation(harness, { codexTransport });
  let supervisorScriptPath: string | undefined;
  if (useSupervisor) {
    supervisorScriptPath = resolvePtySupervisorScriptPath();
    await writePtyToken(tmuxSession);
  }
  let channelsBridgeMcpConfig: string | undefined;
  if (
    !piFields &&
    !codexFields &&
    !acpFields &&
    !kimiCodeFields &&
    !plainFork &&
    isClaudeCodeChannelsEnabled() &&
    (!model || getProviderForModelSync(model).name === 'anthropic') &&
    process.env.CLAUDE_CODE_USE_BEDROCK !== '1' &&
    process.env.CLAUDE_CODE_USE_VERTEX !== '1' &&
    process.env.CLAUDE_CODE_USE_FOUNDRY !== '1' &&
    process.env.OVERDECK_DOCKER_WORKSPACE !== '1' &&
    process.env.PAN_DOCKER !== '1'
  ) {
    channelsBridgeMcpConfig = join(stateDir, 'agent-mcp.json');
    writeBridgeTokenSync(tmuxSession);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, tmuxSession);
  }
  // PAN-1837 review fix: the tmux-create + session-capture sequence below is
  // wrapped per-bucket (withKimiSessionCaptureLock) for kimi-code conversations
  // and genuinely awaited — not fire-and-forget — so two conversations sharing
  // one cwd never snapshot the same "existing sessions" set and race for the
  // same newest directory. Non-kimi harnesses run this closure directly,
  // unaffected by the lock.
  const launchTmuxAndCaptureSession = async (): Promise<void> => {
    // Conversations have no AgentState row, so the dashboard can't resolve
    // their wire.jsonl without a conversation-owned captured session id —
    // snapshot the bucket now (before the tmux session exists, and — for
    // kimi-code — inside the per-bucket lock) so the capture below can diff
    // against it instead of guessing from mtime. Skipped when kimiCodeFields
    // already carries a verified resumeSessionId (PAN-1837 review fix): a
    // true resume must not snapshot/capture a replacement id and overwrite
    // the pinned transcript pointer.
    let kimiExistingSessionsBefore: Set<string> | undefined;
    if (kimiCodeFields && !kimiCodeFields.resumeSessionId) {
      try {
        const { kimiSessionsRoot } = await import('../runtimes/kimi-code.js');
        kimiExistingSessionsBefore = new Set(await readdir(kimiSessionsRoot(join(homedir(), '.kimi-code'), cwd)));
      } catch {
        kimiExistingSessionsBefore = new Set();
      }
    }

    const launcherTmp = `${launcherScript}.${randomUUID()}.tmp`;
    await writeFile(
      launcherTmp,
      generateLauncherScriptSync({
        role: 'work',
        spawnMode: 'conversation',
        workingDir: cwd,
        setTerminalEnv: true,
        unsetProviderEnv: true,
        overdeckEnv: { ...(issueId ? { issueId } : {}), ...((piFields || codexFields || acpFields || useSupervisor) ? { agentId: tmuxSession } : {}) },
        extraEnvExports: [
          harnessLaunch.pathExport,
          `export OVERDECK_DASHBOARD_URL="http://127.0.0.1:${process.env['API_PORT'] ?? process.env['PORT'] ?? '3011'}"`,
        ],
        providerExports: providerExportsStr || undefined,
        trapHup: true,
        baseCommand: runtimeCommand,
        appendSystemPromptFiles: piFields
          ? await piConversationSystemPromptFiles(cwd)
          : codexFields || acpFields || kimiCodeFields
            ? []
            : await claudeConversationSystemPromptFiles(cwd),
        model: launcherModel,
        ...(piFields ?? codexFields ?? acpFields ?? kimiCodeFields ?? {
          resumeSessionId: resume ? claudeSessionId : undefined,
          sessionId: resume ? undefined : claudeSessionId,
        }),
        extraArgs: !piFields && !acpFields && !kimiCodeFields && effort ? `--effort "${effort}"` : undefined,
        keepAlive: true,
        fileMode: 0o700,
        channelsBridgeMcpConfig,
        useSupervisor,
        supervisorScriptPath,
      }),
      { mode: 0o700 },
    );
    await rename(launcherTmp, launcherScript);
    try {
      await Effect.runPromise(killSession(tmuxSession));
    } catch {
    }
    console.log(`[claude-invoke] purpose=conversation-session | model=${model || 'default'} | source=conversations.ts:spawnConversationSession | session=${tmuxSession} | resume=${resume} | command="${runtimeCommand}"`);
    try {
      const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
      preTrustDirectory(cwd);
    } catch { /* non-fatal */ }
    try {
      await Effect.runPromise(createSession(tmuxSession, cwd, `bash ${shellQuote(launcherScript)}`, {
        env: {
          ...BLANKED_PROVIDER_ENV,
          TERM: 'xterm-256color',
        },
      }));
    } catch (err) {
      if ((err as { code?: string })?.code === 'ENOENT') {
        throw new Error(
          'tmux is not installed. Install it with: brew install tmux (macOS) or sudo apt-get install tmux (Linux)',
        );
      }
      throw err;
    }
    if (useSupervisor) {
      await waitForPtySupervisorOrFallback(tmuxSession);
    }
    if (behavior.usesCodexHome && codexFields?.codexHome && codexTransport === 'tui') {
      const codexHomeDir = codexFields.codexHome;
      void (async () => {
        try {
          const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId } =
            await import('../runtimes/codex.js');
          const rollout = await waitForCodexRollout(codexHomeDir, 120_000);
          if (rollout) {
            const threadId = extractThreadIdFromRollout(rollout);
            if (threadId) writeThreadId(tmuxSession, threadId);
          }
        } catch {
        }
      })();
    }
    if (kimiCodeFields && kimiExistingSessionsBefore) {
      // Genuinely awaited (not fire-and-forget) so the per-bucket lock below
      // stays held until this conversation's session directory is captured —
      // that's what makes the next queued launch's snapshot see it as
      // "existing" rather than racing to claim it too.
      //
      // PAN-1837 review fix (cycle 8): a null capture or a thrown error here
      // used to be silently absorbed, so the conversation was still reported
      // healthy with no kimi-session-id pointer — transcript/cost resolution
      // then falls back to the newest session in the shared cwd bucket, which
      // can render a DIFFERENT conversation's or agent's prompts/transcript
      // under this identity. Require a real captured id or fail the launch,
      // same fail-closed contract as spawnAgent/restartAgent/recoverAgent.
      const { waitForNewKimiSessionAsync, writeKimiSessionId } = await import('../runtimes/kimi-code.js');
      const sessionId = await waitForNewKimiSessionAsync(join(homedir(), '.kimi-code'), cwd, kimiExistingSessionsBefore);
      if (!sessionId) {
        throw new Error(
          `kimi-code session capture timed out for ${tmuxSession} — no new session directory appeared under the workspace bucket`,
        );
      }
      writeKimiSessionId(tmuxSession, sessionId);
    }
  };

  if (kimiCodeFields) {
    const { withKimiSessionCaptureLock } = await import('../runtimes/kimi-code.js');
    await withKimiSessionCaptureLock(join(homedir(), '.kimi-code'), cwd, launchTmuxAndCaptureSession);
  } else {
    await launchTmuxAndCaptureSession();
  }
  if (channelsBridgeMcpConfig) {
    void dismissDevChannelsDialog(tmuxSession).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conversations] dismissDevChannelsDialog failed for ${tmuxSession}: ${msg}`);
    });
  }
  await Effect.runPromise(setOption(tmuxSession, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(exactPaneTarget(tmuxSession), 'remain-on-exit', 'on'));
}
export interface ResolvedRegisteredProject {
  key: string;
  config: ProjectConfig;
}

/** Resolve a project key or display name without blocking the dashboard event loop. */
export async function resolveRegisteredProject(
  input: string,
): Promise<ResolvedRegisteredProject | { error: string }> {
  const projects = await listProjectsAsync();
  const project = projects.find((candidate) => candidate.key === input)
    ?? projects.find((candidate) => candidate.config.name === input);
  return project ?? { error: `Unknown project: ${input}` };
}

/**
 * Resolve a conversation's cwd from a project identifier.
 *
 * The Command Deck identifies projects by display name, not yaml key
 * (PAN-2590) — accept either, like GET /api/session-trees does.
 */
export async function resolveProjectCwd(
  projectIdentifier: string,
): Promise<{ key: string; cwd: string } | { error: string }> {
  const resolved = await resolveRegisteredProject(projectIdentifier);
  if ('error' in resolved) return resolved;
  const projectPath = resolved.config.path;
  if (!projectPath) {
    return { error: `Project path does not exist: (unset) (project: ${projectIdentifier})` };
  }
  try {
    await stat(projectPath);
  } catch {
    return { error: `Project path does not exist: ${projectPath} (project: ${projectIdentifier})` };
  }
  return { key: resolved.key, cwd: projectPath };
}

export interface ConversationCreateRequestBody { [key: string]: unknown }
export async function handleConversationCreate(
  body: ConversationCreateRequestBody,
  deps: { generateAiTitle: (name: string, message: string) => Promise<void> },
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
    const model = typeof body['model'] === 'string' ? body['model'].trim() || undefined : undefined;
    const effort = typeof body['effort'] === 'string' ? body['effort'].trim() || undefined : undefined;
    const harness = await resolveAllowedHarness(body['harness'], model);
    const issueId = typeof body['issueId'] === 'string' ? body['issueId'] : undefined;
    const projectKey = typeof body['projectKey'] === 'string' ? body['projectKey'].trim() : undefined;
    if (issueId && !SAFE_ISSUE_ID_PATTERN.test(issueId)) return jsonResponse({ error: 'Invalid issueId' }, { status: 400 });
    if (model && !SAFE_MODEL_PATTERN.test(model)) return jsonResponse({ error: 'Invalid model' }, { status: 400 });
    if (effort && !SAFE_EFFORT_PATTERN.test(effort)) return jsonResponse({ error: 'Invalid effort' }, { status: 400 });
    let cwd = getDefaultCwd();
    let canonicalProjectKey: string | undefined;
    if (projectKey) {
      const resolved = await resolveProjectCwd(projectKey);
      if ('error' in resolved) return jsonResponse({ error: resolved.error }, { status: 400 });
      cwd = resolved.cwd;
      canonicalProjectKey = resolved.key;
    }
    if (message && message.length > 50_000) {
      return jsonResponse({ error: 'message exceeds maximum length of 50000 characters' }, { status: 400 });
    }
    let name = generateConversationName();
    for (let i = 0; i < 5 && getConversationByName(name); i++) name = generateConversationName();
    const tmuxSession = `conv-${name}`;
    const claudeSessionId = randomUUID();
    console.log(`[conversations] Creating conversation "${name}" with model=${model ?? 'default'} effort=${effort ?? 'default'} cwd=${cwd}`);
    const MAX_TITLE_LEN = 60;
    const title = message ? message.slice(0, MAX_TITLE_LEN) + (message.length > MAX_TITLE_LEN ? '…' : '') : 'New conversation';
    const conv = createConversation({ name, tmuxSession, cwd, issueId, claudeSessionId, title, titleSource: message ? 'auto' : 'default', titleSeed: title, model, effort, harness, projectKey: canonicalProjectKey });
    getEventStore().emitOnly({ type: 'conversation.created', timestamp: new Date().toISOString(), payload: { conversationName: name } });
    void (async () => {
      try {
        await spawnConversationSession(tmuxSession, cwd, claudeSessionId, model, effort, issueId, false, harness);
        console.log(`[conversations] tmux session ${tmuxSession} spawned, sessionId: ${claudeSessionId}`);
        await waitForConversationRuntimeReady(tmuxSession, harness, 'spawn');
        if (message) {
          const delivery = await deliverAgentMessage(tmuxSession, message, 'conversation-message', resolveConversationDeliveryMethod(conv));
          if (harness === 'acp' && !delivery.ok) {
            throw new Error(`ACP initial prompt did not land: ${delivery.failure ?? 'unknown failure'}`);
          }
        }
      } catch (spawnErr: unknown) {
        const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
        console.error(`[conversations] background spawn failed for ${tmuxSession}: ${msg}`);
        // PAN-1837 review fix: kimi-code needs the same teardown-on-failure as
        // acp — a failed capture must not leave a running tmux session with
        // no owned native identity presented as a healthy conversation.
        if (harness === 'acp' || harness === 'kimi-code') await stopConversationRuntime(conv, name);
        updateSpawnError(name, msg);
        getEventStore().emitOnly({ type: 'conversation.created', timestamp: new Date().toISOString(), payload: { conversationName: name } });
      }
    })();
    if (message) {
      void deps.generateAiTitle(name, message).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
      });
    }
    return jsonResponse({ ...conv, sessionAlive: false }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] create conversation failed:', msg);
    return jsonResponse({ error: msg || 'Internal server error' }, { status: error instanceof UnknownModelError ? 400 : 500 });
  }
}
export async function handleConversationStop(name: string, deps: { resolveSessionFileForCleanup?: (conv: Conversation) => string | null }): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    await stopConversationRuntime(conv, name);
    markConversationEnded(name);
    void (async () => {
      await new Promise((r) => setTimeout(r, 500));
      await cleanupUnreferencedConversationAttachments({ name: conv.name, sessionFile: deps.resolveSessionFileForCleanup?.(conv) ?? null });
    })();
    return jsonResponse({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] stop conversation failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}
export async function handleConversationClearForkState(
  name: string,
  deps: {
    sessionExists?: (session: string) => Promise<boolean>;
    clearFailureState?: (conversation: string) => void;
  } = {},
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  if (!await (deps.sessionExists ?? tmuxSessionExists)(conv.tmuxSession)) {
    return jsonResponse({ error: 'Cannot clear failure state while the tmux session is not alive' }, { status: 409 });
  }
  (deps.clearFailureState ?? clearConversationFailureState)(name);
  return jsonResponse({ ...(getConversationByName(name) ?? conv), sessionAlive: true });
}
export async function handleConversationResume(
  name: string,
  body: Record<string, unknown>,
  deps: { resolveSessionFile: (conv: Conversation) => Promise<string | null> },
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const model = typeof body['model'] === 'string' && body['model'].trim() ? body['model'].trim() : (conv.model ?? undefined);
    const effort = typeof body['effort'] === 'string' && body['effort'].trim() ? body['effort'].trim() : (conv.effort ?? undefined);
    const claudeAlive = await isHarnessProcessAlive(conv.tmuxSession);
    if (claudeAlive) {
      updateLastAttached(name);
      markConversationActive(name);
      return jsonResponse({ ...conv, status: 'active', reattached: true });
    }
    const oldSessionId = conv.claudeSessionId, resumeCause = conv.status === 'ended' ? 'operator' : 'system', sendResumeContract = body['sendResumeContract'] !== false;
    const harness: RuntimeName = conv.harness ?? 'claude-code';
    const modelChanged = !!model && model !== conv.model;
    if (!(await validateCwdContainment(conv.cwd))) return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
    if (model && modelChanged && !SAFE_MODEL_PATTERN.test(model)) return jsonResponse({ error: 'Invalid model' }, { status: 400 });
    if (model && modelChanged) setConversationModel(name, model);
    let canResume = !!oldSessionId;
    if (oldSessionId) {
      const resumeFile = await deps.resolveSessionFile(conv);
      if (!resumeFile || !existsSync(resumeFile)) {
        canResume = false;
        console.error(`[conversations] SESSION-LOST ${name} harness=${harness} claudeSessionId=${oldSessionId} resolved=${resumeFile ?? 'null'} — resuming with a fresh session`);
      }
    }
    const respawn = markRespawnPending(conv.tmuxSession);
    try {
      await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, effort, conv.issueId ?? undefined, canResume, harness);
      await waitForTmuxSession(conv.tmuxSession);
      await waitForConversationRuntimeReady(conv.tmuxSession, harness, 'respawn');
      // The harness may open its own blocking gate on resume. The operator owns
      // that answer, so the contract delivery seam skips rather than races it.
      await deliverResumeContractUnlessGated(
        conv.tmuxSession,
        `CONVERSATION RESUME: ${buildResumeContract(resumeCause)}`,
        'conversation-resume',
        resolveConversationDeliveryMethod(conv),
        sendResumeContract,
      );
      markConversationActive(name);
      return jsonResponse({ ...conv, status: 'active', model: model ?? conv.model, harness, reattached: false, sessionAlive: true });
    } catch (error) {
      // PAN-1837 review fix: kimi-code needs the same teardown-on-failure as
      // acp — a failed capture must not leave a running tmux session with no
      // owned native identity presented as a healthy conversation.
      if (harness === 'acp' || harness === 'kimi-code') await stopConversationRuntime(conv, name);
      throw error;
    } finally {
      respawn.done();
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] resume conversation failed:', msg);
    return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
  }
}
export async function handleConversationDelete(
  name: string,
  deps: { invalidateFavoritesCache: () => void },
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    await stopConversationRuntime(conv, name);
    markConversationEnded(name);
    archiveConversation(name);
    removeFavorite('conversation', name);
    deps.invalidateFavoritesCache();
    await cleanupConversationAttachments(name);
    return jsonResponse({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] delete conversation failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}
export async function handleConversationRestartAll(
  deps: { resolveSessionFile: (conv: Conversation) => Promise<string | null> },
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const allConvs = listConversations();
    const liveSessionNames = new Set(await Effect.runPromise(listSessionNames()));
    const convs = allConvs.filter((c) => liveSessionNames.has(c.tmuxSession));
    const results: { name: string; model: string | null; status: string }[] = [];
    for (const conv of convs) {
      const respawn = markRespawnPending(conv.tmuxSession);
      let attemptedHarness: RuntimeName = conv.harness ?? 'claude-code';
      try {
        await Effect.runPromise(killSession(conv.tmuxSession).pipe(Effect.catch(() => Effect.succeed(undefined))));
        const oldSessionId = conv.claudeSessionId;
        const sessionFileForResume = await deps.resolveSessionFile(conv);
        const canResume = !!oldSessionId && !!sessionFileForResume && existsSync(sessionFileForResume);
        const harness = await resolveAllowedHarness(conv.harness, conv.model);
        attemptedHarness = harness;
        await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), conv.model ?? undefined, conv.effort ?? undefined, conv.issueId ?? undefined, canResume, harness);
        if (harness === 'acp') {
          await waitForConversationRuntimeReady(conv.tmuxSession, harness, 'respawn');
        }
        setConversationHarness(conv.name, harness);
        markConversationActive(conv.name);
        results.push({ name: conv.name, model: conv.model, status: 'restarted' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[conversations] Failed to restart ${conv.name}:`, msg);
        // PAN-1837 review fix: kimi-code needs the same teardown-on-failure as
        // acp — a failed capture must not leave a running tmux session with no
        // owned native identity presented as a healthy conversation.
        if (attemptedHarness === 'acp' || attemptedHarness === 'kimi-code') await stopConversationRuntime(conv, conv.name);
        results.push({ name: conv.name, model: conv.model, status: 'failed' });
      } finally {
        respawn.done();
      }
    }
    console.log(`[conversations] Restarted ${results.filter(r => r.status === 'restarted').length}/${convs.length} conversations`);
    return jsonResponse({ restarted: results.length, results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] restart conversations failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}
