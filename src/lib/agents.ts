import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync, statSync, statfsSync, rmSync } from 'fs';
import { mkdir, readFile, readdir, rm, stat as statAsync, writeFile, writeFile as writeFileAsync, mkdir as mkdirAsync, rename as renameAsync } from 'fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR, encodeClaudeProjectDir, getOverdeckHome, packageRoot, resolveOhmypiExtensionPath, resolvePiExtensionPath, sessionFilePath } from './paths.js';
import { resolveBareNumericIdSync } from './issue-id.js';
import { getClaudePermissionFlagsStringSync, resolvePermissionModeSync } from './claude-permissions.js';
import { createSessionSync, createSession, killSessionSync, killSession, sendKeys, sendRawKeystroke, sessionExistsSync, sessionExists, listSessions, listSessionsSync, capturePaneSync, capturePane, listPaneValuesSync, listPaneValues, isPaneDead, setOption, exactPaneTarget } from './tmux.js';
import { initHookSync, checkHookSync, generateFixedPointPromptSync } from './hooks.js';
import { findLatestRollout, extractThreadIdFromRollout } from './runtimes/codex.js';
import { startWorkSync, completeWorkSync, getAgentCVSync } from './cv.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId, ComplexityLevel } from './settings.js';
import { getProviderForModelSync, getProviderEnvSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from './providers.js';
import { validateProviderHealth } from './provider-health.js';
import { loadConfigSync as loadYamlConfig, isClaudeCodeChannelsMcpEnabled, resolveModel, isTldrEnabledSync } from './config-yaml.js';
import type { NormalizedCavemanConfig, RoleEffort } from './config-yaml.js';
import type { AuthMode } from './subscription-types.js';
import { readCavemanVariant } from './caveman/workspace.js';
import { loadConfigSync } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { getClaudeAuthStatus } from './claude-auth.js';
import { bridgeGeminiAuthToCliproxy, getCliproxyClientEnv } from './cliproxy.js';
import { ensureOpenAICompatibleProxyRunning } from './openai-compatible-proxy.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPathSync, getIssuePrefix, resolveProjectFromIssueSync } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';
import { generateLauncherScriptSync } from './launcher-generator.js';
import { createConversation, getConversationByName, reactivateConversationForSpawn, normalizeHarness } from './overdeck/conversations.js';
import { getOverdeckAgentStateSync, listOverdeckAgentStatesSync, saveOverdeckAgentStateSync } from './overdeck/agent-state-sync.js';
import { readAgentHarnessModelRecordSync, writeAgentHarnessModelRecordSync } from './overdeck/agent-record-sync.js';
import { getRollbackAgentStatePath, readRollbackAgentStateSync, writeRollbackAgentStateSync } from './overdeck/agent-rollback-state.js';
import { workspaceContextFile } from './context-layers/layers.js';
import { ensureSessionContextBriefingFile } from './briefing-freshness.js';
import { logAgentLifecycleSync } from './persistent-logger.js';
import { buildCompactRecoverySeedMessage } from './context-overflow.js';
import { ALLOW_SESSION_ROTATION_ON_RESUME, sessionRotationRefused } from './session-rotation.js';
import { emitActivityEntrySync, emitActivityTtsSync } from './activity-logger.js';
import { BRIDGE_TOKEN_HEADER, readBridgeTokenSync, writeBridgeTokenSync } from './bridge-token.js';
import { PTY_TOKEN_HEADER, readPtyToken, writePtyToken } from './pty-token.js';
import { resolveHarness } from './harness-resolve.js';
import { resetPipelineVerdictsForWorkStartSync } from './review-status.js';
import type { RuntimeName } from './runtimes/types.js';
import { createPiFifo, piFifoPaths, writePiCommandSync, PiNotReady } from './runtimes/pi-fifo.js';
import { createOhmypiFifo, ohmypiFifoPaths, writeOhmypiCommandSync, OhmypiNotReady } from './runtimes/ohmypi-fifo.js';
import { resolveLatestOhmypiSessionId } from './runtimes/ohmypi.js';
import { Effect } from 'effect';
import { FsError, TmuxError } from './errors.js';
import { assertIssueHasBeads, BeadsMissingError } from './beads-query.js';
import { BdTransientFailure } from './bd-process-lock.js';
import { getWorkspaceStackHealth } from './workspace/stack-health.js';
import { normalizeModelOverrideSync, requireModelOverrideSync, shellQuoteModelIdSync } from './model-validation.js';
import { resolveAutoResumeConfigForIssue } from './cloister/auto-resume-config.js';
import { recordFeatureRegistryLifecycle } from './registry/feature-registry-population.js';
import { getFlywheelActiveRunIdSync } from './overdeck/control-settings.js';
import { appendOperatorInterventionEvent } from './operator-interventions.js';
import { captureTranscriptUserRecordSnapshot, hasNewTranscriptUserRecord, type TranscriptUserRecordSnapshot } from './transcript-landing.js';
import { sendGracefulRestartWarning } from './graceful-restart.js';
import type { MemoryIdentity, AgentStatus } from '@overdeck/contracts';
import { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync } from './agents/queries.js';
import { stopAgent, stopAgentSync } from './agents/termination.js';

const execAsync = promisify(exec);
const missingRoleDefinitionWarnings = new Set<string>();

const toAgentFsError = (operation: string, path: string, cause: unknown): FsError =>
  new FsError({ operation, path, cause });

export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | 'strike' | 'sequencer';

type FlywheelSpawnEnv = {
  OVERDECK_FLYWHEEL_RUN_ID?: string;
  OVERDECK_FLYWHEEL_AGENT_ROLE?: Role;
};

function normalizeFlywheelRunId(runId: string | null | undefined): string | undefined {
  if (!runId) return undefined;
  const trimmed = runId.trim();
  return /^RUN-\d+$/.test(trimmed) ? trimmed : undefined;
}

function resolveFlywheelSpawnEnv(role: Role, runIdOverride?: string | null): FlywheelSpawnEnv {
  const runId = normalizeFlywheelRunId(runIdOverride ?? getFlywheelActiveRunIdSync());
  return runId
    ? { OVERDECK_FLYWHEEL_RUN_ID: runId, OVERDECK_FLYWHEEL_AGENT_ROLE: role }
    : {};
}

function flywheelEnvExports(env: FlywheelSpawnEnv): string[] {
  return [
    env.OVERDECK_FLYWHEEL_RUN_ID ? `export OVERDECK_FLYWHEEL_RUN_ID=${env.OVERDECK_FLYWHEEL_RUN_ID}` : undefined,
    env.OVERDECK_FLYWHEEL_AGENT_ROLE ? `export OVERDECK_FLYWHEEL_AGENT_ROLE=${env.OVERDECK_FLYWHEEL_AGENT_ROLE}` : undefined,
  ].filter((value): value is string => value !== undefined);
}

/**
 * Write an agent launcher script atomically. Every agent shares a fixed
 * `launcher.sh` path inside its agent dir, and spawn/resume/restart paths can
 * overlap (e.g. a Deacon recovery racing a manual restart). Writing in place
 * lets one path read a half-written script; write to a unique temp file then
 * rename (atomic on the same filesystem).
 */
async function writeLauncherScriptAtomic(launcherScript: string, content: string): Promise<void> {
  const tmp = `${launcherScript}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { mode: 0o755 });
  await renameAsync(tmp, launcherScript);
}

async function claudeSystemPromptFiles(workspace: string, harness: RuntimeName | undefined): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(workspace);
  try {
    await statAsync(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNodeNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());

  // PAN-1566: ohmypi also receives the rendered global context layer.
  if (harness === 'ohmypi') {
    const { piGlobalContextFile } = await import('./context-layers/index.js');
    const globalFile = piGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  // PAN-1574: Codex receives its rendered global context layer (codex-global.md).
  if (harness === 'codex') {
    const { codexGlobalContextFile } = await import('./context-layers/index.js');
    const globalFile = codexGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  return files;
}

function isNodeNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for the active agent
 * runtime. Returns true if any process in the tree matches the expected harness,
 * false if the tree exists but no match, false on any error.
 *
 * Used by sendAgentMessage zombie detection. pane_pid is the tmux pane's root
 * process, which is bash for work-agent launchers (`bash launcher.sh`) but can
 * be the runtime directly for specialists (`exec claude ...` / `exec pi ...`).
 */
async function hasAgentRuntimeInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<boolean> {
  const expectedProcessNames = harness === 'ohmypi' ? new Set(['omp']) : harness === 'codex' ? new Set(['codex']) : new Set(['claude']);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || !/^\d+$/.test(pid)) continue;
    seen.add(pid);

    try {
      const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`);
      const name = comm.trim();
      if (expectedProcessNames.has(name)) return true;
    } catch {
      continue;
    }

    try {
      const { stdout: kids } = await execAsync(`pgrep -P ${pid}`);
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch {
      // pgrep exits non-zero when there are no children — not an error.
    }
  }
  return false;
}

async function getPiLauncherFields(agentId: string, model: string): Promise<{
  harness: 'ohmypi';
  piExtensionPath: string;
  piFifoPath: string;
  piSessionDir: string;
  model: string;
}> {
  const paths = piFifoPaths(agentId);
  await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
  const piExtensionPath = resolvePiExtensionPath();
  if (!piExtensionPath) {
    throw new Error(
      `Pi extension not built. Run: npm run build\n(looked for dist/extensions/pi.js and packages/pi-extension/dist/index.js under ${packageRoot})`
    );
  }
  // PAN-1048 review feedback 006 (S1): thread the resolved role/workhorse model
  // through to buildPiCommand. The Pi launcher branch ignores baseCommand and
  // rebuilds from scratch starting with the literal `pi`, so the only way to
  // surface --model is via the launcher config's `model` field. Without this,
  // a Pi-backed role silently fell back to Pi's default model and ignored the
  // configured workhorse model entirely.
  return {
    harness: 'ohmypi',
    piExtensionPath,
    piFifoPath: await Effect.runPromise(createPiFifo(agentId)),
    piSessionDir: paths.agentDir,
    model,
  };
}

async function getOhmypiLauncherFields(agentId: string, model: string): Promise<{
  harness: 'ohmypi';
  piExtensionPath: string;
  piFifoPath: string;
  piSessionDir: string;
  model: string;
}> {
  const paths = ohmypiFifoPaths(agentId);
  await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
  const ohmypiExtensionPath = resolveOhmypiExtensionPath();
  if (!ohmypiExtensionPath) {
    throw new Error(
      `ohmypi extension not built. Run: npm run build\n(looked for dist/extensions/ohmypi.js and packages/ohmypi-extension/dist/index.js under ${packageRoot})`
    );
  }
  return {
    harness: 'ohmypi',
    piExtensionPath: ohmypiExtensionPath,
    piFifoPath: await Effect.runPromise(createOhmypiFifo(agentId)),
    piSessionDir: paths.agentDir,
    model,
  };
}

function getCodexLauncherFields(agentId: string, model: string, workspacePath?: string): {
  harness: 'codex';
  codexMode: 'work-tui';
  codexHome: string;
  codexSessionDir: string;
  model: string;
} {
  const codexHome = join(homedir(), '.overdeck', 'agents', agentId, 'codex-home');
  // PAN-1803: codex work agents must inherit the user's configured codex
  // permission level (Settings → Permissions → Codex) and pre-trust the
  // workspace, EXACTLY like the conversation path
  // (routes/conversations.ts). Without trustedDir, codex shows its first-run
  // folder-trust / "load project-local config?" wizard and blocks the pane.
  // Without the permission mapping, work agents ignore the Settings choice
  // and run hardcoded never+workspace-write.
  const codexPermMode = loadYamlConfig().config.codex?.permissionMode ?? 'workspace';
  const approvalPolicy = codexPermMode === 'full-access' ? 'never' : 'on-request';
  const sandboxMode =
    codexPermMode === 'full-access' ? 'danger-full-access'
    : codexPermMode === 'read-only' ? 'read-only'
    : 'workspace-write';
  const approvalsReviewer = codexPermMode === 'auto-review' ? 'auto_review' : undefined;
  initCodexHome(codexHome, {
    trustedDir: workspacePath,
    approvalPolicy,
    sandboxMode,
    approvalsReviewer,
  });
  return {
    harness: 'codex',
    codexMode: 'work-tui',
    codexHome,
    codexSessionDir: join(codexHome, 'sessions'),
    model,
  };
}

/**
 * Wait for the Pi work-agent ready marker (`ready.json`) to appear.
 * Pi does not produce the Claude SessionStart hook signal, so resume/restart
 * paths must use this instead of `waitForReadySignal()`.
 */
async function waitForPiAgentReady(agentId: string, timeoutSec = 30): Promise<boolean> {
  const { readyPath } = piFifoPaths(agentId);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export const OHMYPI_AGENT_READY_TIMEOUT_SECONDS = 120;

async function waitForOhmypiAgentReady(agentId: string, timeoutSec = OHMYPI_AGENT_READY_TIMEOUT_SECONDS): Promise<boolean> {
  const { readyPath } = ohmypiFifoPaths(agentId);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * PAN-2100: build a diagnostic suffix for an ohmypi readiness failure.
 *
 * An ENOSPC (disk-full) omp crash surfaces as an opaque "did not become ready"
 * timeout — omp cannot write `ready.json` when the disk is full. That exact
 * condition crashed flywheel-orchestrator (RUN-20) and the only record of it sat
 * unread in output.log for hours, sending the flywheel down a wrong "kimi→ohmypi
 * misroute" diagnosis. Surface the real signals at throw time: free disk on the
 * Overdeck-home filesystem and the tail of the agent's output.log. Best-effort:
 * every probe is independently guarded so diagnostics never mask the real error.
 */
export function describeOhmypiSpawnFailure(agentId: string): string {
  const parts: string[] = [];
  try {
    const { bavail, bsize } = statfsSync(getOverdeckHome());
    const freeMb = Math.round((bavail * bsize) / (1024 * 1024));
    parts.push(`freeDisk=${freeMb}MiB`);
    if (freeMb < 512) parts.push('(DISK NEARLY FULL — likely ENOSPC crash)');
  } catch { /* statfs best-effort */ }
  try {
    const logPath = join(getAgentDir(agentId), 'output.log');
    if (existsSync(logPath)) {
      const tail = readFileSync(logPath, 'utf8').slice(-1500).trim().split('\n').slice(-8).join('\n');
      if (tail) parts.push(`output.log tail:\n${tail}`);
    }
  } catch { /* best-effort */ }
  return parts.length ? ` [${parts.join(' ')}]` : '';
}

async function waitForCodexTuiReady(agentId: string, timeoutSec = 30): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      if (!(await Effect.runPromise(sessionExists(agentId)))) return false;
      const pane = await Effect.runPromise(capturePane(agentId, 80));
      // The codex TUI is ready when its input prompt (a line starting with the
      // `›` glyph) AND its status line (`<model> ... · <cwd>`) are both on
      // screen. PAN-1803: the previous check keyed off the first-run
      // trust-wizard markers ("press enter to continue") — but pre-trusting the
      // workspace (correctly) skips that wizard, so those markers never appear
      // and the kickoff never fired. Detect the actual ready prompt instead.
      const hasInputPrompt = /^\s*[›>]\s/m.test(pane);
      const hasStatusLine = /·\s+[~/]/.test(pane);
      if (hasInputPrompt && hasStatusLine) {
        return true;
      }
      // Fallback: if pre-trust ever fails and the wizard does appear, treat its
      // markers as ready (the kickoff paste will dismiss + drive it).
      if (/press enter to continue/i.test(pane) || /ctrl[+-][cj]/i.test(pane)) {
        return true;
      }
    } catch {
      // The pane may not exist yet immediately after tmux session creation.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function waitForPromptReady(agentId: string, harness: RuntimeName | undefined, timeoutSec = 30): Promise<boolean> {
  if (harness === 'codex') return waitForCodexTuiReady(agentId, timeoutSec);
  return waitForReadySignal(agentId, timeoutSec);
}

/**
 * Inject prompt-time memory context into a Pi prompt (PAN-1546).
 * Mirrors Claude Code's UserPromptSubmit hook behaviour: every follow-up
 * prompt gets relevant memory surfaced via RAG.
 */
async function injectPiPromptTimeMemory(agentId: string, prompt: string): Promise<string> {
  if (!prompt.trim()) return prompt;

  const agentState = getAgentStateSync(agentId);
  if (!agentState || !agentState.workspace || !agentState.issueId) {
    return prompt;
  }

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(agentState.workspace),
      workspaceId: basename(agentState.workspace),
      issueId: agentState.issueId,
      runId: agentId,
      sessionId: agentId,
      agentRole: agentState.role ?? 'work',
      agentHarness: agentState.harness ?? 'claude-code',
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    const result = await injectPromptTimeMemory({ prompt, identity, surface: 'user-prompt' });
    if (result.context) {
      return `${result.context}\n\n---\n\n${prompt}`;
    }
  } catch (error) {
    console.warn(`[agents] Prompt-time memory injection failed for ${agentId}:`, error instanceof Error ? error.message : String(error));
  }
  return prompt;
}

/**
 * Prompt-time memory injection for a Pi CONVERSATION follow-up (PAN-1546).
 *
 * The rpc/work-agent path (injectPiPromptTimeMemory) reads agent-state.json,
 * which conversations do not have — they deliver follow-ups via tmux
 * paste-buffer, not the FIFO. This builds the memory identity from the
 * conversation's cwd + issueId instead. Only issue-linked conversations have
 * memory to surface; everything else (and any failure) passes through
 * unchanged so a memory hiccup can never block a message.
 */
export async function injectPiConversationMemory(
  opts: { cwd: string; issueId?: string | null; conversationName: string },
  prompt: string,
): Promise<string> {
  if (!prompt.trim() || !opts.issueId || !opts.cwd) return prompt;
  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(opts.cwd),
      workspaceId: basename(opts.cwd),
      issueId: opts.issueId,
      runId: opts.conversationName,
      sessionId: opts.conversationName,
      agentRole: 'work',
      agentHarness: 'ohmypi',
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    const result = await injectPromptTimeMemory({ prompt, identity, surface: 'user-prompt' });
    if (result.context) {
      return `${result.context}\n\n---\n\n${prompt}`;
    }
  } catch (error) {
    console.warn(`[agents] Conversation memory injection failed for ${opts.conversationName}:`, error instanceof Error ? error.message : String(error));
  }
  return prompt;
}

/**
 * Deliver a prompt to a Pi work agent through the FIFO JSONL command protocol.
 * Pi never reads tmux input — pasting prompts there is a no-op as far as the
 * model is concerned. Throws if Pi never reached readiness within the timeout.
 */
async function writePiAgentPrompt(agentId: string, prompt: string, timeoutSec = 30): Promise<void> {
  const augmentedPrompt = await injectPiPromptTimeMemory(agentId, prompt);
  const ready = await waitForPiAgentReady(agentId, timeoutSec);
  if (!ready) {
    throw new Error(`Pi agent ${agentId} did not become ready within ${timeoutSec}s`);
  }
  try {
    writePiCommandSync(agentId, { id: randomUUID(), type: 'prompt', message: augmentedPrompt });
  } catch (err) {
    if (err instanceof PiNotReady) {
      throw new Error(`Pi agent ${agentId} reader gone before prompt could be delivered: ${err.message}`);
    }
    throw err;
  }
}

async function writeOhmypiAgentPrompt(agentId: string, prompt: string, timeoutSec = OHMYPI_AGENT_READY_TIMEOUT_SECONDS): Promise<void> {
  const augmentedPrompt = await injectPiPromptTimeMemory(agentId, prompt);
  const ready = await waitForOhmypiAgentReady(agentId, timeoutSec);
  if (!ready) {
    throw new Error(`ohmypi agent ${agentId} did not become ready within ${timeoutSec}s${describeOhmypiSpawnFailure(agentId)}`);
  }
  try {
    writeOhmypiCommandSync(agentId, { id: randomUUID(), type: 'prompt', message: augmentedPrompt });
  } catch (err) {
    if (err instanceof OhmypiNotReady) {
      throw new Error(`ohmypi agent ${agentId} reader gone before prompt could be delivered: ${err.message}`);
    }
    throw err;
  }
}

export async function getProviderAuthMode(model: string): Promise<AuthMode | undefined> {
  const provider = getProviderForModelSync(model);
  if (provider.name === 'anthropic') {
    const authStatus = await Effect.runPromise(getClaudeAuthStatus());
    if (authStatus.hasAnthropicApiKey) return 'api-key';
    return authStatus.loggedIn ? 'subscription' : undefined;
  }

  if (provider.name === 'openai') {
    const { config } = loadYamlConfig();
    const authStatus = await Effect.runPromise(getOpenAIAuthStatus());
    return authStatus.loggedIn
      ? 'subscription'
      : (config.providerAuth?.openai ?? 'api-key');
  }

  if (provider.name === 'google') {
    const { config } = loadYamlConfig();
    return config.providerAuth?.google;
  }

  return undefined;
}

/** Map abstract/future model names to CLIProxy-supported names.
 *  The CLIProxy registry has gpt-5.4 but not gpt-5.4-pro. */
const CLI_PROXY_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.5-pro': 'gpt-5.5',
  'gpt-5.4-pro': 'gpt-5.4',
};

/**
 * Build the base command that the launcher will exec for an agent.
 *
 * The `harness` parameter (PAN-636) selects between Claude Code (default)
 * and ohmypi/Pi. When `harness === 'ohmypi'` the function short-circuits to a
 * `omp --mode rpc --model <model>` line; the launcher generator then layers
 * --session-dir, --extension, --no-context-files, and the stdin-from-fifo
 * redirect on top via generateLauncherScript. The `agentName` (PAN-982:
 * --name) and `agentDefinition` (PAN-982: --agent) parameters only apply to the
 * Claude Code path — ohmypi has no agent-definition system.
 */
export async function getAgentRuntimeBaseCommand(
  model: string,
  agentName?: string,
  agentDefinition?: string,
  harness: RuntimeName = 'claude-code',
  effort?: RoleEffort,
): Promise<string> {
  const validatedModel = requireModelOverrideSync(model);
  const quotedModel = shellQuoteModelIdSync(validatedModel);
  if (harness === 'ohmypi') {
    return `omp --mode rpc --model ${quotedModel}`;
  }
  if (harness === 'codex') {
    // buildCodexCommand in launcher-generator builds the full Codex command;
    // return a stub base command so the launcher generator can short-circuit.
    return `codex`;
  }

  // Integration tests can inject a harmless harness command so a leaked or
  // intentionally-real tmux session never runs the production `claude` binary.
  if (process.env.OVERDECK_TEST_HARNESS_COMMAND) {
    return process.env.OVERDECK_TEST_HARNESS_COMMAND;
  }

  const provider = getProviderForModelSync(validatedModel);
  // PAN-982: --name <agentId> creates a human-readable Claude session name discoverable via
  // `claude --resume`.
  const nameFlag = agentName ? ` --name ${agentName}` : '';

  // Classify agentDefinition. A registered agent NAME (e.g. pan-review-agent,
  // resolved from ~/.claude/agents/*.md) still launches via `--agent <name>` —
  // Claude Code 2.1.195 resolves names natively, and its frontmatter owns
  // permissionMode/tools/effort. A role definition FILE (roles/<role>.md) can no
  // longer be passed to --agent (PAN-2087: 2.1.195 dropped --agent file support),
  // so its frontmatter-stripped body is injected as an appended system prompt.
  const defIsRoleFile = !!agentDefinition
    && existsSync(resolve(agentDefinition))
    && statSync(resolve(agentDefinition)).isFile();

  if (agentDefinition && !defIsRoleFile) {
    // Registered agent NAME — unchanged. --model still wins over any frontmatter
    // default model; permissionMode/effort come from the named agent's frontmatter.
    const agentFlag = ` --agent ${agentDefinition}`;
    const effortFlag = effort ? ` --effort ${effort}` : '';
    if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
      const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
      return `claude${agentFlag} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
    }
    return `claude${agentFlag} --model ${quotedModel}${effortFlag}${nameFlag}`;
  }

  // PAN-2087: role FILE (inject body + effort) or no definition. permissionMode
  // comes from the global permission flags; the role's hooks fire globally via
  // ~/.claude/settings.json. roleInject folds in effort when a role file is
  // present; otherwise --effort is passed directly.
  const permissionFlags = getClaudePermissionFlagsStringSync();
  const roleInject = defIsRoleFile ? roleSystemPromptInjectionSync(agentDefinition as string, effort) : '';
  const effortFlag = (!defIsRoleFile && effort) ? ` --effort ${effort}` : '';

  // OpenAI subscription → local CLIProxyAPI sidecar exposes an
  // Anthropic-compatible /v1/messages endpoint, so Claude Code can drive
  // gpt-* models directly via ANTHROPIC_BASE_URL (no wrapper process).
  // The provider env vars are injected separately by getProviderEnvForModel.
  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    // CLIProxy supports gpt-5.x but not the -pro variant; map aliases to real names.
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    return `claude ${permissionFlags}${roleInject} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
  }

  return `claude ${permissionFlags}${roleInject} --model ${quotedModel}${effortFlag}${nameFlag}`;
}

/**
 * Resolve the role's Claude-harness agent-definition path.
 *
 * Returns the file Claude Code's `--agent` flag should load to seed the run
 * with the role's frontmatter (permissions, tools, hooks, default model).
 * Returns `null` when the role does not have a Claude agent definition — for
 * example, the review convoy sub-roles, whose prompts are harness-agnostic
 * templates the orchestrator inlines into the spawn message (see
 * `buildConvoyPrompt` in `src/lib/cloister/review-agent.ts`). Sub-role
 * templates live in `roles/review-<subRole>.md`; they are deliberately not
 * loaded via `--agent` so the same content drives Claude Code, Pi, and
 * future harnesses uniformly and never auto-discovers as an ambient Claude
 * subagent inside a work agent's session.
 *
 * Without a sub-role the return is always the top-level role file; callers
 * can rely on the overload to avoid null-handling on that path.
 */
export function roleAgentDefinitionPath(role: Role): string;
export function roleAgentDefinitionPath(role: Role, subRole: string | undefined): string | null;
export function roleAgentDefinitionPath(role: Role, subRole?: string): string | null {
  if (role === 'review' && subRole) {
    return null;
  }
  return `roles/${role}.md`;
}

/**
 * PAN-2087: Claude Code 2.1.195 removed support for passing an agent DEFINITION
 * FILE to `--agent` — it now resolves only registered agent NAMES (from
 * `~/.claude/agents/*.md`). Role definitions live as files (`roles/<role>.md`),
 * so `claude --agent roles/<role>.md` started failing with "agent not found" and
 * the agent exited on launch. Instead of `--agent`, inject the role's BODY as an
 * appended system prompt and translate its `effort:` frontmatter to `--effort`.
 *
 * Everything the role frontmatter used to supply via `--agent` is reconstituted
 * as flags:
 *   - body        → `--append-system-prompt-file` (frontmatter stripped)
 *   - `effort:`   → `--effort`
 *   - `mcpServers:` → a generated `--mcp-config` JSON (PAN-2090)
 *   - `tools:`    → `--allowedTools` (PAN-2090), with each declared MCP server
 *     appended as `mcp__<name>` so the role can still call its own MCP tools —
 *     otherwise the strict allow-list would block e.g. playwright for `test`.
 *
 * The role frontmatter's hooks are deliberately NOT reconstituted: they are
 * installed globally in `~/.claude/settings.json` and fire for every claude
 * session, and per the PAN-1402 note Claude Code never honored path-form
 * `--agent` frontmatter hooks anyway. permissionMode is covered by the
 * launcher's permission flags. Generated artifacts are cached under
 * `~/.overdeck/role-prompts/` and referenced by absolute path, so they do not
 * depend on `roles/` existing in the agent's cwd.
 *
 * Returns the flags (with a leading space) to splice in place of the old
 * `--agent <file>` flag, or '' when the definition file is missing.
 */
function roleSystemPromptInjectionSync(definitionPath: string, explicitEffort?: RoleEffort): string {
  const abs = resolve(definitionPath);
  if (!existsSync(abs)) return '';
  const raw = readFileSync(abs, 'utf8');
  let body = raw;
  let frontmatter: Record<string, unknown> = {};
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    try {
      const parsed = parseYaml(fm[1]);
      if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
    } catch {
      // Malformed frontmatter — fall back to body-only injection.
    }
  }

  const dir = join(getOverdeckHome(), 'role-prompts');
  mkdirSync(dir, { recursive: true });
  const stem = basename(definitionPath).replace(/\.md$/, '');
  const outPath = join(dir, `${stem}.md`);
  writeFileSync(outPath, body);

  const flags: string[] = [` --append-system-prompt-file '${outPath}'`];

  const effort = explicitEffort ?? (typeof frontmatter.effort === 'string' ? (frontmatter.effort as RoleEffort) : undefined);
  if (effort) flags.push(` --effort ${effort}`);

  // mcpServers: a YAML list of single-key maps ({ playwright: { … } }). Flatten
  // into one { mcpServers: { name: def } } config loaded via --mcp-config. It is
  // additive (the launcher's channels --mcp-config still applies; no
  // --strict-mcp-config), so the role keeps any project/global MCP servers too.
  const mcpNames: string[] = [];
  if (Array.isArray(frontmatter.mcpServers) && frontmatter.mcpServers.length > 0) {
    const servers: Record<string, unknown> = {};
    for (const entry of frontmatter.mcpServers) {
      if (entry && typeof entry === 'object') {
        for (const [name, def] of Object.entries(entry as Record<string, unknown>)) {
          servers[name] = def;
          mcpNames.push(name);
        }
      }
    }
    if (Object.keys(servers).length > 0) {
      const mcpPath = join(dir, `${stem}.mcp.json`);
      writeFileSync(mcpPath, JSON.stringify({ mcpServers: servers }, null, 2));
      flags.push(` --mcp-config '${mcpPath}'`);
    }
  }

  // tools: allow-list → --allowedTools (comma-joined single arg so the variadic
  // never swallows later flags). Append `mcp__<server>` for each declared MCP
  // server so its tools survive the strict allow-list.
  if (Array.isArray(frontmatter.tools)) {
    const toolNames = frontmatter.tools.filter((t): t is string => typeof t === 'string');
    if (toolNames.length > 0) {
      const allowed = [...toolNames, ...mcpNames.map((n) => `mcp__${n}`)];
      flags.push(` --allowedTools '${allowed.join(',')}'`);
    }
  }

  return flags.join('');
}

/** Build a Claude/ohmypi base command for role-based runs. */
export async function getRoleRuntimeBaseCommand(
  model: string,
  agentName: string,
  role: Role,
  harness: RuntimeName = 'claude-code',
  subRole?: string,
  effort?: RoleEffort,
): Promise<string> {
  const validatedModel = requireModelOverrideSync(model);
  const quotedModel = shellQuoteModelIdSync(validatedModel);
  if (harness === 'ohmypi') {
    return `omp --mode rpc --model ${quotedModel}`;
  }
  if (harness === 'codex') {
    return `codex`;
  }

  // Integration tests can inject a harmless harness command so a leaked or
  // intentionally-real tmux session never runs the production `claude` binary.
  if (process.env.OVERDECK_TEST_HARNESS_COMMAND) {
    return process.env.OVERDECK_TEST_HARNESS_COMMAND;
  }

  const provider = getProviderForModelSync(validatedModel);
  const requestedDefinitionPath = roleAgentDefinitionPath(role, subRole);
  const definitionPath = requestedDefinitionPath && existsSync(resolve(requestedDefinitionPath))
    ? requestedDefinitionPath
    : null;
  if (requestedDefinitionPath && !definitionPath && !missingRoleDefinitionWarnings.has(requestedDefinitionPath)) {
    missingRoleDefinitionWarnings.add(requestedDefinitionPath);
    console.warn(
      `[agents] Role definition ${resolve(requestedDefinitionPath)} does not exist; launching ${role} without its role system prompt`,
    );
  }
  // PAN-2087: inject the role body (+ effort frontmatter) as an appended system
  // prompt instead of `--agent <file>` (Claude Code dropped --agent file support).
  const roleInject = definitionPath ? roleSystemPromptInjectionSync(definitionPath, effort) : '';
  const nameFlag = ` --name ${agentName}`;
  const effortFlag = (!definitionPath && effort) ? ` --effort ${effort}` : '';
  // permissionMode now comes from the global permission flags for EVERY role
  // (the old --agent path relied on role frontmatter, which Claude Code no longer
  // applies). This honors the user's bypass/auto setting uniformly.
  const permissionFlags = ` ${getClaudePermissionFlagsStringSync()}`;

  // PAN-1557: convoy sub-reviewers now run as interactive, attachable sessions
  // (prompt delivered via tmux, completion signalled by the Stop-hook) instead
  // of headless `claude --print`. No role uses --print anymore.
  const printFlag = '';

  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    return `claude${printFlag}${roleInject}${permissionFlags} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
  }

  return `claude${printFlag}${roleInject}${permissionFlags} --model ${quotedModel}${effortFlag}${nameFlag}`;
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
// Singleton runners spawn under their own bare ID (spawnRun creates the tmux
// session and agent dir from the raw ID). They MUST be listed here so
// normalizeAgentId is a no-op for them — otherwise message delivery and state
// lookups would target `agent-<id>` and miss the real session (PAN-1866: the
// sequencer spawned but its prompt was delivered to a nonexistent
// `agent-sequencer-runner` pane, leaving the agent idle).
const SINGLETON_AGENT_IDS = new Set(['flywheel-orchestrator', 'sequencer-runner']);

/** Normalize agent ID: preserve known prefixes, add 'agent-' for bare issue IDs */
export function normalizeAgentId(agentId: string): string {
  if (SINGLETON_AGENT_IDS.has(agentId)) return agentId;
  if (AGENT_PREFIXES.some(p => agentId.startsWith(p))) {
    return agentId;
  }
  return `agent-${agentId.toLowerCase()}`;
}

/** True when the input is already a fully-qualified agent ID (known prefix or singleton), not an issue ID. */
export function isQualifiedAgentId(input: string): boolean {
  const lower = input.toLowerCase();
  return SINGLETON_AGENT_IDS.has(lower) || AGENT_PREFIXES.some(p => lower.startsWith(p));
}

/**
 * Resolve a CLI-supplied agent target to an on-disk agent ID (PAN-1760).
 * Accepts bare numerics ("1148"), issue IDs ("PAN-1148"), and fully-qualified
 * agent IDs ("agent-pan-1148-ship", "strike-pan-1723", "inspect-pan-1744-x",
 * "flywheel-orchestrator"). For issue IDs, prefers the canonical work-agent
 * directory when present, then falls back to the single registered agent state
 * for that issue. If no single fallback exists, preserves the historical
 * canonical agent-* target.
 */
export function resolveAgentTargetSync(input: string): string | null {
  if (isQualifiedAgentId(input)) return input.toLowerCase();
  const issueId = resolveBareNumericIdSync(input);
  if (!issueId) return null;

  const canonicalAgentId = normalizeAgentId(issueId);
  if (getAgentStateSync(canonicalAgentId)) return canonicalAgentId;

  try {
    const wantedIssueId = issueId.toUpperCase();
    const matches = listOverdeckAgentStatesSync()
      .filter((agent) => agent.issueId.toUpperCase() === wantedIssueId)
      .map((agent) => agent.id);
    if (matches.length === 1) return matches[0].toLowerCase();
    return canonicalAgentId;
  } catch {
    return canonicalAgentId;
  }
}

/**
 * Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for a model.
 * Reads the current API key from settings so resumed/recovered agents
 * always use the latest key.
 */
export async function getProviderEnvForModel(model: string): Promise<Record<string, string>> {
  const provider = getProviderForModelSync(model);
  if (provider.name === 'anthropic') return {};

  const { config } = loadYamlConfig();

  // OpenRouter API key is stored in config.yaml under providers.openrouter.api_key
  if (provider.name === 'openrouter') {
    const apiKey = config.apiKeys.openrouter;
    if (apiKey) {
      return getProviderEnvSync(provider, apiKey);
    }
    throw new Error(`OpenRouter API key not configured. Add your key in Settings → OpenRouter before using model "${model}".`);
  }

  const apiKey = config.apiKeys[provider.name as keyof typeof config.apiKeys];

  if (provider.name === 'google') {
    if (!apiKey) {
      throw new Error(`Google API key not configured. Add GOOGLE_API_KEY in Settings → Google or ~/.overdeck.env before using model "${model}".`);
    }

    if (!await Effect.runPromise(bridgeGeminiAuthToCliproxy(apiKey))) {
      throw new Error(`Failed to bridge Google API key into CLIProxy before using model "${model}".`);
    }

    return getCliproxyClientEnv();
  }

  if (provider.name === 'openai') {
    const authStatus = await Effect.runPromise(getOpenAIAuthStatus());
    if (authStatus.loggedIn) {
      // Route through the local CLIProxyAPI sidecar using the user's
      // ChatGPT subscription OAuth tokens. Claude Code sees a normal
      // Anthropic-compatible endpoint and never needs an API key.
      return getCliproxyClientEnv();
    }

    const configuredKey = apiKey || authStatus.hasOpenAIApiKey;
    throw new Error(
      configuredKey
        ? `OpenAI API-key routing is no longer supported for model "${model}" because api.openai.com does not expose an Anthropic-compatible /v1/messages endpoint. Sign in with a Codex/ChatGPT subscription via \`pan admin specialists codex login\` or Dashboard Settings → Codex Login.`
        : `Codex/ChatGPT subscription login required for OpenAI model "${model}". Sign in via \`pan admin specialists codex login\` or Dashboard Settings → Codex Login.`,
    );
  }

  if (apiKey) {
    if (provider.name === 'nous') {
      await Effect.runPromise(ensureOpenAICompatibleProxyRunning());
    }
    await Effect.runPromise(validateProviderHealth(model, apiKey));
    return getProviderEnvSync(provider, apiKey);
  }

  throw new Error(`No API key configured for ${provider.displayName}. Configure it in Settings before using model "${model}".`);
}

/**
 * Get bash export lines for provider env vars (for use in launcher scripts).
 * Returns empty string for Anthropic models.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  // Pi-native provider env vars (bridged from Overdeck settings so Pi can auth)
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'ZAI_API_KEY',
  'MIMO_API_KEY',
  'OPENROUTER_API_KEY',
  'NOUS_API_KEY',
  'DASHSCOPE_API_KEY',
] as const;

export async function getProviderExportsForModel(model: string): Promise<string> {
  const envVars = await getProviderEnvForModel(model);
  const unsetLines = PROVIDER_ENV_KEYS.map(key => `unset ${key}`);
  const exportLines = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`);

  return [...unsetLines, ...exportLines].join('\n') + '\n';
}

/**
 * Build a sanitized env for programmatically spawning `claude`.
 *
 * The dashboard parent process may inherit provider env vars (e.g.
 * ANTHROPIC_BASE_URL pointing at the CLIProxy sidecar) that would mis-route
 * a child process targeting an Anthropic model. Launcher *scripts* strip
 * these via `unset` lines; programmatic spawns must do the same.
 *
 * Returns a copy of `baseEnv` (default: process.env) with all PROVIDER_ENV_KEYS
 * deleted, then overlaid with the correct provider env for `model`.
 */
export async function buildSpawnEnvForModel(
  model: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if ((PROVIDER_ENV_KEYS as readonly string[]).includes(k)) continue;
    sanitized[k] = v;
  }
  const providerEnv = await getProviderEnvForModel(model);
  return { ...sanitized, ...providerEnv };
}

/**
 * Get tmux -e flags for provider env vars (for use in tmux new-session).
 * Returns empty string for Anthropic models.
 */
export async function getProviderTmuxFlags(model: string): Promise<string> {
  const envVars = await getProviderEnvForModel(model);
  let flags = '';
  for (const [key, value] of Object.entries(envVars)) {
    flags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
  }
  return flags;
}

// ============================================================================
// Ready Signal Management (PAN-87)
// ============================================================================

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getAgentDir(agentId), 'ready.json');
}

/**
 * Clear ready signal before spawning (clean slate)
 */
export function clearReadySignal(agentId: string): void {
  const readyPath = getReadySignalPath(agentId);
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // Ignore errors - non-critical
    }
  }
}

/**
 * Wait for agent to be ready (async - non-blocking).
 *
 * Hook-driven (PAN-1594): readiness is signaled by `ready.json`, written by the
 * session-start hook (Claude) / Pi extension when the session reaches the
 * prompt, and cleared by clearReadySignal() before each (re)launch — so its
 * presence means the *current* session is ready for input. There is no tmux
 * pane-scrape fallback and no dependency on permission mode (the old fallback
 * matched the bypass-permissions footer `⏵⏵` / `bypass permissions on`, which
 * silently broke readiness for every non-bypass agent).
 *
 * Returns true if the ready signal arrives within the timeout, false otherwise.
 */
function isReadySignalPresent(readyPath: string): boolean {
  if (!existsSync(readyPath)) return false;
  try {
    const signal = JSON.parse(readFileSync(readyPath, 'utf-8'));
    // Accept both the Claude hook shape ({ ready: true, ... }) and the Pi
    // extension shape ({ agentId, sessionId, ... } with no `ready` field).
    return Boolean(signal && typeof signal === 'object' && signal.ready !== false);
  } catch {
    // File exists but mid-write / invalid — keep waiting.
    return false;
  }
}

export async function waitForReadySignal(agentId: string, timeoutSeconds = 30): Promise<boolean> {
  const readyPath = getReadySignalPath(agentId);

  for (let i = 0; i < timeoutSeconds; i++) {
    if (isReadySignalPresent(readyPath)) return true;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Non-blocking sleep
  }

  return isReadySignalPresent(readyPath);
}

function promptReadyTimeoutSeconds(): number {
  const raw = process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS;
  if (!raw) return 30;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * Wait until a hook-instrumented agent reports it is idle at the prompt, via the
 * runtime mirror (Stop / SessionStart hook → activity 'idle'), or the timeout
 * elapses. Returns true if idle was observed.
 *
 * PAN-1594/1596: this is the hook-derived "is the agent idle right now" check.
 * It replaced the tmux pane-scrape `waitForClaudePrompt` (since removed). Works
 * for any hook-instrumented session — agents AND conversations (`conv-*`), which
 * feed the runtime mirror once their heartbeat POSTs authenticate (PAN-1596). No
 * dependency on tmux output or permission mode.
 *
 * Distinct from waitForReadySignal: that answers the one-time "has this
 * (re)launched session reached the prompt" (ready.json gate, used by the
 * conversation reattach/fork paths); this answers "is the running agent idle at
 * the prompt right now".
 */
export async function waitForAgentIdle(agentId: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (getAgentRuntimeStateSync(agentId)?.state === 'idle') return true;
    await new Promise(r => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return getAgentRuntimeStateSync(agentId)?.state === 'idle';
}

export type DeliveryResult = {
  ok: boolean;
  path: 'supervisor' | 'channels' | 'tmux' | 'pi' | 'codex';
  failure?: string;
};

const SESSION_EXITED_BEFORE_KICKOFF = 'session-exited-before-kickoff';

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  /** Coding-agent harness this agent runs under (PAN-636). */
  harness?: RuntimeName;
  /** Unified role primitive (PAN-1048). */
  role: Role;
  model: string;
  /**
   * The exact spawn key fed to the weighted-distribution model picker at spawn
   * (`${role}:${issueId}`), persisted so the dashboard MODEL inspector (PAN-2053)
   * can show the faithful FNV-1a derivation without re-guessing the key's form.
   * Undefined for scalar-role agents and for agents spawned before PAN-2053.
   */
  modelSpawnKey?: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  lastResumeAt?: string;
  /**
   * Tri-state kickoff delivery signal for work-agent lifecycle monitoring:
   * undefined = legacy/pre-feature agent or non-applicable role;
   * false = spawned but kickoff delivery not yet confirmed;
   * true = kickoff delivery confirmed.
   */
  kickoffDelivered?: boolean;
  stoppedAt?: string;
  /** True when markAgentStopped was called (user-initiated stop). Cleared on
   *  resume. Read by deacon's autoResumeStoppedWorkAgents to distinguish a
   *  deliberate stop from a crash/orphan. */
  stoppedByUser?: boolean;
  stoppedByPause?: boolean;
  paused?: boolean;
  pausedReason?: string;
  pausedAt?: string;
  troubled?: boolean;
  troubledAt?: string;
  consecutiveFailures?: number;
  firstFailureInRunAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastFailureNextRetryAt?: string;
  branch?: string; // Git branch name for this agent
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Current work type ID

  /**
   * Whether this work agent was launched with the experimental Claude Code
   * Channels prompt-delivery path enabled. Set at launch time after the
   * eligibility check; never mutated after. Read by deliverAgentMessage to
   * decide whether to attempt the bridge socket before falling back to
   * sendKeysAsync. Absent or false means tmux-only delivery (current default).
   */
  channelsEnabled?: boolean;
  /** True when this work agent was launched through the PTY supervisor wrapper. */
  supervisorEnabled?: boolean;
  /**
   * Delivery method for agent messages. 'auto' tries supervisor, then channels,
   * then tmux; explicit socket methods are strict (throw on failure); 'tmux'
   * bypasses socket transports entirely.
   */
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';

  /**
   * Short HEAD sha (8 chars) of the workspace at the moment this role run was
   * spawned. Used by the reactive scheduler's activeRoleRunExists() to detect a
   * stale/zombie role session: if the workspace HEAD has advanced past this
   * marker, the existing session ran against old code and must not block a
   * fresh re-dispatch for the new HEAD. Set for non-work roles in spawnRun.
   */
  roleRunHead?: string;

  /** Flywheel run that spawned this agent, if any. Absent for operator-started agents (PAN-1812). */
  flywheelRunId?: string;

  /** Review-convoy metadata for server-side reviewer lifecycle monitoring. */
  reviewSubRole?: string;
  reviewRunId?: string;
  reviewOutputPath?: string;
  reviewSynthesisAgentId?: string;
  reviewDeadlineAt?: string;
  reviewMonitorSignaled?: 'ready' | 'failed' | 'timeout';
  /** Number of times Deacon has respawned this convoy reviewer (PAN-1806). */
  reviewRetryAttempt?: number;
  hostOverride?: boolean;

  /** Inspect sub-role for inspect-* agents (PAN-1834). */
  inspectSubRole?: string;
}

export function getAgentDir(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId);
}

export function getAgentStateFilePath(agentId: string): string {
  return getRollbackAgentStatePath(agentId);
}

/**
 * PAN-1985: wipe agent state directories for an issue, optionally scoped to
 * a role prefix. Used by the restart-fresh and review-restart paths to clean
 * state before respawning — the new agent then reads `.pan/continue.json`,
 * the vBRIEF, the beads, and the branch to pick up where the prior run left
 * off. Refuses to run against an empty or unsafe id.
 *
 * - `rolePrefix` omitted: wipes only the work agent dir (`agent-<id>`).
 *   Specialist dirs (review, test, ship, etc.) are left alone.
 * - `rolePrefix` set (e.g. 'review'): wipes the role parent dir
 *   (`agent-<id>-<prefix>`) AND any sub-roles (`agent-<id>-<prefix>-<anything>`),
 *   leaving the work agent dir alone.
 *
 * Refuses to operate on the root `AGENTS_DIR` itself or on paths that escape
 * it; the `validateAgentId` guard below enforces a conservative id grammar.
 */
export async function wipeAgentStateDirs(
  issueId: string,
  opts: { rolePrefix?: string } = {},
): Promise<{ removed: string[]; path: string }> {
  if (!issueId || !/^[A-Za-z]+-\d+$/.test(issueId)) {
    throw new Error(`wipeAgentStateDirs: invalid issueId "${issueId}"`);
  }
  if (opts.rolePrefix !== undefined && !/^[a-z][a-z0-9-]*$/.test(opts.rolePrefix)) {
    throw new Error(`wipeAgentStateDirs: invalid rolePrefix "${opts.rolePrefix}"`);
  }
  const issueLower = issueId.toLowerCase();
  const dirPath = join(AGENTS_DIR, `agent-${issueLower}${opts.rolePrefix ? `-${opts.rolePrefix}` : ''}`);
  let entries: string[];
  try {
    entries = await readdir(AGENTS_DIR);
  } catch {
    return { removed: [], path: dirPath };
  }
  let targets: string[];
  if (opts.rolePrefix) {
    const base = `agent-${issueLower}-${opts.rolePrefix}`;
    targets = entries.filter((name) => name === base || name.startsWith(`${base}-`));
  } else {
    const work = `agent-${issueLower}`;
    targets = entries.filter((name) => name === work);
  }
  for (const name of targets) {
    try {
      await rm(join(AGENTS_DIR, name), { recursive: true, force: true });
    } catch { /* non-fatal — best-effort wipe */ }
  }
  return { removed: targets, path: dirPath };
}

export function isRole(value: unknown): value is Role {
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship' || value === 'flywheel' || value === 'strike' || value === 'sequencer';
}

function cleanAgentState(raw: AgentState): AgentState {
  return {
    id: raw.id,
    issueId: raw.issueId,
    workspace: raw.workspace,
    harness: raw.harness,
    role: raw.role,
    model: raw.model,
    status: raw.status,
    startedAt: raw.startedAt,
    lastActivity: raw.lastActivity,
    lastResumeAt: raw.lastResumeAt,
    kickoffDelivered: raw.kickoffDelivered,
    stoppedAt: raw.stoppedAt,
    stoppedByUser: raw.stoppedByUser,
    stoppedByPause: raw.stoppedByPause,
    paused: raw.paused,
    pausedReason: raw.pausedReason,
    pausedAt: raw.pausedAt,
    troubled: raw.troubled,
    troubledAt: raw.troubledAt,
    consecutiveFailures: raw.consecutiveFailures,
    firstFailureInRunAt: raw.firstFailureInRunAt,
    lastFailureAt: raw.lastFailureAt,
    lastFailureReason: raw.lastFailureReason,
    lastFailureNextRetryAt: raw.lastFailureNextRetryAt,
    branch: raw.branch,
    costSoFar: raw.costSoFar,
    sessionId: raw.sessionId,
    roleRunHead: raw.roleRunHead,
    channelsEnabled: raw.channelsEnabled,
    supervisorEnabled: raw.supervisorEnabled,
    deliveryMethod: raw.deliveryMethod,
    reviewSubRole: raw.reviewSubRole,
    reviewRunId: raw.reviewRunId,
    reviewOutputPath: raw.reviewOutputPath,
    reviewSynthesisAgentId: raw.reviewSynthesisAgentId,
    reviewDeadlineAt: raw.reviewDeadlineAt,
    reviewMonitorSignaled: raw.reviewMonitorSignaled,
    reviewRetryAttempt: raw.reviewRetryAttempt,
    hostOverride: raw.hostOverride,
    inspectSubRole: raw.inspectSubRole,
  };
}

function parseAgentState(content: string, normalizedId: string): AgentState | null {
  try {
    const state = JSON.parse(content) as Partial<AgentState>;
    if (!isRole(state.role)) {
      // Roleless states are invisible to getAgentState; cleanup is handled
      // by warnOnBareNumericIssueIds / dropLegacyAgentStatesMissingRoleAsync.
      return null;
    }
    if (!state.id) state.id = normalizedId;
    return cleanAgentState(state as AgentState);
  } catch {
    return null;
  }
}

export function getAgentStateSync(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);

  const overdeckState = getOverdeckAgentStateSync(normalizedId);
  if (overdeckState) return cleanAgentState(overdeckState);

  const state = readRollbackAgentStateSync(normalizedId, parseAgentState);
  if (!state) return null;

  // PAN-1919: harness/model are no longer sourced from state.json. Merge from
  // the per-issue git-tracked record so cross-machine pickup works.
  if (state.issueId) {
    const record = readAgentHarnessModelRecordSync(state.issueId);
    if (record?.harness) state.harness = record.harness;
    if (record?.model) state.model = record.model;
  }

  return state;
}

export const getAgentState = (agentId: string): Effect.Effect<AgentState | null, FsError> => {
  return Effect.try({
    try: () => getAgentStateSync(agentId),
    catch: (cause) => toAgentFsError('read', `agents-db:${agentId}`, cause),
  });
};

function prepareAgentStateForSave(state: AgentState): AgentState {
  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }
  return state;
}

export function writeAgentStateJsonSync(state: AgentState): void {
  writeRollbackAgentStateSync(state, (clean) => JSON.stringify(cleanAgentState(clean), null, 2));
}

export function saveAgentStateSync(state: AgentState): void {
  // Detect status transition for audit trail
  const oldState = getAgentStateSync(state.id);
  const oldStatus = oldState?.status;

  prepareAgentStateForSave(state);

  saveOverdeckAgentStateSync(state);
  writeAgentStateJsonSync(state);

  // PAN-1919: mirror harness/model into the per-issue git-tracked record so
  // they travel with the branch. Done synchronously at save time; auto-commit
  // is suppressed here because spawn paths explicitly queue the commit.
  if (state.issueId && state.harness && state.model) {
    try {
      writeAgentHarnessModelRecordSync(state.issueId, state.harness, state.model);
    } catch (err) {
      console.warn(`[agents] Failed to mirror harness/model to record for ${state.issueId}: ${(err as Error).message}`);
    }
  }

  if (oldStatus && oldStatus !== state.status) {
    logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentState)`);
  }
}

export const saveAgentState = (state: AgentState): Effect.Effect<void, FsError> => {
  const dir = getAgentDir(state.id);
  const stateFile = getRollbackAgentStatePath(state.id);

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdirAsync(dir, { recursive: true }),
      catch: (cause) => toAgentFsError('mkdir', dir, cause),
    });

    const oldState = yield* getAgentState(state.id);
    const oldStatus = oldState?.status;

    if (state.status === 'running' || state.status === 'starting') {
      delete state.stoppedAt;
    } else if (state.status === 'stopped' && !state.stoppedAt) {
      state.stoppedAt = new Date().toISOString();
    }

    yield* Effect.try({
      try: () => saveOverdeckAgentStateSync(state),
      catch: (cause) => toAgentFsError('write', `agents-db:${state.id}`, cause),
    });

    yield* Effect.tryPromise({
      try: () => writeFileAsync(stateFile, JSON.stringify(cleanAgentState(state), null, 2)),
      catch: (cause) => toAgentFsError('write', stateFile, cause),
    });
    recordFeatureRegistryAgentState(state);

    // PAN-1919: mirror harness/model into the per-issue git-tracked record.
    if (state.harness && state.model) {
      yield* Effect.try({
        try: () => writeAgentHarnessModelRecordSync(state.issueId, state.harness!, state.model!),
        catch: (cause) => toAgentFsError('write', `record:${state.issueId}`, cause),
      });
    }

    if (oldStatus && oldStatus !== state.status) {
      logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentStateProgram)`);
    }
  });
};

function recordFeatureRegistryAgentState(state: AgentState): void {
  const status = state.status === 'starting' || state.status === 'running' ? 'active' : 'deferred';
  void recordFeatureRegistryLifecycle({
    issueId: state.issueId,
    workspacePath: state.workspace,
    agentId: state.id,
    status,
  });
}

function clearFailureTrackingFields(state: AgentState): void {
  state.consecutiveFailures = 0;
  delete state.firstFailureInRunAt;
  delete state.lastFailureAt;
  delete state.lastFailureReason;
  delete state.lastFailureNextRetryAt;
}

/**
 * Marker prefix used by the flywheel orchestrator when pausing an agent solely
 * to free a governor work slot. Pauses for this reason must never leave the
 * agent troubled (PAN-1812).
 */
export const GOVERNOR_SLOT_PAUSE_REASON_PREFIX = '[governor-slot]';

function isGovernorSlotPauseReason(reason: string | undefined): boolean {
  return reason !== undefined && reason.startsWith(GOVERNOR_SLOT_PAUSE_REASON_PREFIX);
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
function applyAgentPaused(state: AgentState, reason?: string, stoppedByPause = false): void {
  if (!state.paused) {
    state.pausedAt = new Date().toISOString();
  }
  state.paused = true;
  if (stoppedByPause) {
    state.stoppedByPause = true;
  }
  if (reason === undefined) {
    delete state.pausedReason;
  } else {
    state.pausedReason = reason;
  }

  // PAN-1812: a governor slot pause is a resource-hygiene action, not a fault.
  // Clear any existing troubled gate so the agent remains resumable when a slot
  // frees.
  if (isGovernorSlotPauseReason(reason)) {
    delete state.troubled;
    delete state.troubledAt;
  }
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
export function setAgentPausedSync(agentId: string, reason?: string, stoppedByPause = false): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentPaused(state, reason, stoppedByPause);
  saveAgentStateSync(state);
  return true;
}


export const setAgentPaused = (
  agentId: string,
  reason?: string,
  stoppedByPause = false,
): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentPaused(state, reason, stoppedByPause);
    yield* saveAgentState(state);
    return state;
  });

function applyAgentUnpaused(state: AgentState): void {
  if (state.stoppedByPause === true) {
    delete state.stoppedByUser;
  }
  delete state.stoppedByPause;
  delete state.paused;
  delete state.pausedReason;
  delete state.pausedAt;
}

function isAgentPauseClear(state: AgentState): boolean {
  return !state.paused && state.pausedReason === undefined && state.pausedAt === undefined;
}

/** Clears the persistent manual pause gate without spawning the agent. */
export function clearAgentPausedSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentPauseClear(state)) return true;

  applyAgentUnpaused(state);
  saveAgentStateSync(state);
  return true;
}


export const clearAgentPaused = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentPauseClear(state)) return state;

    applyAgentUnpaused(state);
    yield* saveAgentState(state);
    return state;
  });

/** Marks an agent as troubled after repeated resume failures. */
export function markAgentTroubled(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  if (!state.troubled) {
    state.troubledAt = new Date().toISOString();
  }
  state.troubled = true;
  saveAgentStateSync(state);
  return true;
}

function isAgentTroubledClear(state: AgentState): boolean {
  return !state.troubled && state.troubledAt === undefined && (state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined;
}

function applyAgentUntroubled(state: AgentState): void {
  delete state.troubled;
  delete state.troubledAt;
  clearFailureTrackingFields(state);
}

/** Clears the troubled gate and its accumulated failure state. */
export function clearAgentTroubledSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentTroubledClear(state)) return true;

  applyAgentUntroubled(state);
  saveAgentStateSync(state);
  return true;
}


export const clearAgentTroubled = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentTroubledClear(state)) return state;

    applyAgentUntroubled(state);
    yield* saveAgentState(state);
    return state;
  });

function applyAgentFailure(state: AgentState, reason: string): void {
  const config = resolveAutoResumeConfigForIssue(state.issueId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const firstFailureMs = Date.parse(state.firstFailureInRunAt ?? '');
  const hasValidFirstFailure = Number.isFinite(firstFailureMs);
  const windowElapsed = hasValidFirstFailure
    && nowMs - firstFailureMs > config.troubledWindowMs;

  if (windowElapsed || !hasValidFirstFailure) {
    state.consecutiveFailures = 1;
    state.firstFailureInRunAt = now;
  } else {
    state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
  }

  const backoffSeconds = config.failureBackoffSchedule[
    Math.min(state.consecutiveFailures - 1, config.failureBackoffSchedule.length - 1)
  ];
  state.lastFailureAt = now;
  state.lastFailureReason = reason;
  state.lastFailureNextRetryAt = new Date(nowMs + backoffSeconds * 1000).toISOString();

  const firstFailureInRunMs = Date.parse(state.firstFailureInRunAt ?? '');
  const shouldMarkTroubled = state.consecutiveFailures >= config.maxConsecutiveFailures
    && Number.isFinite(firstFailureInRunMs)
    && nowMs - firstFailureInRunMs <= config.troubledWindowMs;

  if (shouldMarkTroubled) {
    if (!state.troubled) {
      state.troubledAt = now;
    }
    state.troubled = true;
  }
}

/** Records one failed resume/crash observation for later backoff and troubled gating. */
export function recordAgentFailureSync(agentId: string, reason: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentFailure(state, reason);
  saveAgentStateSync(state);
  return true;
}


export const recordAgentFailure = (agentId: string, reason: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentFailure(state, reason);
    yield* saveAgentState(state);
    return state;
  });

/** Resets failure tracking after an agent reaches running state. */
export function resetAgentFailureCount(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if ((state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined) return true;

  clearFailureTrackingFields(state);
  saveAgentStateSync(state);
  return true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the manual pause gate. */
export function isAgentPaused(agentId: string): boolean {
  return getAgentStateSync(agentId)?.paused === true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the troubled gate. */
export function isAgentTroubled(agentId: string): boolean {
  return getAgentStateSync(agentId)?.troubled === true;
}

/** Update just the delivery method on an agent's state file. */
export async function setAgentDeliveryMethod(
  agentId: string,
  deliveryMethod: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<void> {
  const state = await Effect.runPromise(getAgentState(agentId));
  if (!state) return;
  state.deliveryMethod = deliveryMethod;
  await Effect.runPromise(saveAgentState(state));
}

/**
 * PAN-1988: resume / feedback / continue delivery must be RESILIENT. When an agent is pinned to
 * the strict 'supervisor' transport — which throws with NO fallback when its echo-confirmation
 * fails (the recurring "input echo confirmation failed" that left review feedback undelivered to
 * the work agent every round) — deliver via 'auto' instead, so a supervisor failure falls back to
 * the proven tmux paste-buffer and the message still lands. Other explicit methods
 * ('tmux'/'channels'/'auto') are preserved. The strict 'supervisor' contract itself (PAN-1769) is
 * intentionally left intact in deliverAgentMessage for callers that opt into it directly.
 */
function resilientDeliveryMethod(
  method: 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined,
): 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined {
  return method === 'supervisor' ? 'auto' : method;
}

/**
 * Resolve OVERDECK_HOME — same fallback semantics as overdeck-bridge.
 */
function overdeckHomeForSockets(): string {
  return process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
}

function overdeckHomeForChannels(): string {
  return overdeckHomeForSockets();
}

/**
 * Append a delivery-event log line to the per-agent bridge log. Best-effort.
 */
async function appendChannelDeliveryLog(
  agentId: string,
  entry: {
    path: 'supervisor' | 'channel' | 'tmux';
    reason?: string;
    caller?: string;
    'pty-supervisor'?: string;
    channels?: string;
  },
): Promise<void> {
  try {
    const home = overdeckHomeForSockets();
    const dir = join(home, 'logs');
    await (await import('fs/promises')).mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      agentId,
      ...entry,
    });
    await (await import('fs/promises')).appendFile(
      join(dir, `bridge-${agentId}.log`),
      `${line}\n`,
      'utf-8',
    );
  } catch {
    // Non-critical
  }
}

/**
 * POST a JSON body to a Unix-domain socket using node:net + a hand-rolled
 * minimal HTTP/1.1 request. Resolves on a 200-class response, rejects on any
 * error including socket-not-found, connection refused, write timeout, or
 * non-2xx status. Kept tiny on purpose: this is a hot path, only one caller,
 * and the whole point of a fallback to tmux is that we do not need a robust
 * HTTP client here.
 */
async function postUnixSocketJson(
  socketPath: string,
  body: unknown,
  timeoutMs: number,
  token: string,
  tokenHeader: string = BRIDGE_TOKEN_HEADER,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);

  return new Promise((resolveCall, reject) => {
    // Settle exactly once. Without this guard a late idle-timeout or
    // post-response socket error could reject after the response already
    // resolved the promise.
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clearClientTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    };
    const finishOk = (value: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      clearClientTimeout();
      resolveCall(value);
    };
    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearClientTimeout();
      reject(err);
    };

    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [tokenHeader]: token,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            finishOk({ status, body: responseBody });
            return;
          }
          finishErr(new Error(`socket POST: status ${status}: ${responseBody.slice(0, 100)}`));
        });
      },
    );

    timeout = setTimeout(() => {
      req.destroy(new Error('socket POST timeout'));
    }, timeoutMs);
    timeout.unref?.();
    req.on('error', (err: Error) => {
      finishErr(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Single delivery primitive for orchestrator-to-work-agent messages. Auto mode
 * tries the PTY supervisor socket, then legacy Channels MCP, then tmux. Explicit
 * socket methods are strict and throw instead of falling back.
 */
export async function deliverAgentMessage(
  agentId: string,
  message: string,
  caller: string = 'unknown',
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<DeliveryResult> {
  const normalizedId = normalizeAgentId(agentId);

  let channelsEnabled = false;
  let resolvedMethod = deliveryMethod;
  try {
    const state = await Effect.runPromise(getAgentState(normalizedId));
    channelsEnabled = Boolean(state?.channelsEnabled);
    resolvedMethod ??= state?.deliveryMethod ?? 'auto';
  } catch {
    resolvedMethod ??= 'auto';
  }

  if (resolvedMethod === 'tmux') {
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux' };
  }

  let supervisorFailure: string | undefined;
  if (resolvedMethod === 'auto' || resolvedMethod === 'supervisor') {
    const supervisorSocketPath = join(overdeckHomeForSockets(), 'sockets', `pty-${normalizedId}.sock`);
    const ptyToken = await readPtyToken(normalizedId);
    if (!existsSync(supervisorSocketPath)) {
      supervisorFailure = 'socket-missing';
    } else if (!ptyToken) {
      supervisorFailure = 'pty-token-missing';
    } else {
      try {
        // Must exceed the supervisor's worst-case echo-confirmation path
        // (2 attempts × 2.5s + 2 purges × 150ms ≈ 5.3s, pty-supervisor.ts).
        // A shorter client timeout abandons the POST mid-retry and fires the
        // tmux fallback while the supervisor is still writing — re-creating
        // the duplicate-submit race PAN-1769 fixed.
        await postUnixSocketJson(
          supervisorSocketPath,
          { content: message, meta: { caller } },
          8_000,
          ptyToken,
          PTY_TOKEN_HEADER,
        );
        await appendChannelDeliveryLog(normalizedId, { path: 'supervisor', caller });
        return { ok: true, path: 'supervisor' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        supervisorFailure = `socket-post-failed: ${reason}`;
      }
    }

    if (resolvedMethod === 'supervisor') {
      throw new Error(`MessageDeliveryFailed: PTY supervisor delivery failed for ${normalizedId} (${caller}): ${supervisorFailure}`);
    }
  }

  if (resolvedMethod === 'auto' || resolvedMethod === 'channels') {
    let channelFailure: string | undefined;
    const socketPath = join(overdeckHomeForSockets(), 'sockets', `agent-${normalizedId}.sock`);
    if (!channelsEnabled) {
      channelFailure = 'channels-disabled';
    } else if (!existsSync(socketPath)) {
      channelFailure = 'socket-missing';
    } else {
      const bridgeToken = readBridgeTokenSync(normalizedId);
      if (!bridgeToken) {
        channelFailure = 'bridge-token-missing';
      } else {
        try {
          await postUnixSocketJson(
            socketPath,
            { content: message, meta: { caller } },
            2000,
            bridgeToken,
          );
          await appendChannelDeliveryLog(normalizedId, {
            path: 'channel',
            caller,
            ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
          });
          return { ok: true, path: 'channels' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          channelFailure = `socket-post-failed: ${reason}`;
        }
      }
    }

    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: Channels delivery failed for ${normalizedId} (${caller}): ${channelFailure}`);
    }

    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: channelFailure,
      caller,
      ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
      ...(channelFailure ? { channels: channelFailure } : {}),
    });
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux', failure: channelFailure ?? supervisorFailure };
  }

  await Effect.runPromise(sendKeys(normalizedId, message));
  return { ok: true, path: 'tmux' };
}

const RESUME_TRANSCRIPT_CONFIRM_TIMEOUT_MS = 3_000;
const RESUME_TRANSCRIPT_CONFIRM_INTERVAL_MS = 100;

async function waitForTranscriptUserRecordLanding(
  workspace: string,
  sessionId: string,
  before: TranscriptUserRecordSnapshot,
  snapshot: typeof captureTranscriptUserRecordSnapshot,
  timeoutMs = RESUME_TRANSCRIPT_CONFIRM_TIMEOUT_MS,
  intervalMs = RESUME_TRANSCRIPT_CONFIRM_INTERVAL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const fromByteOffset = before.readOffset ?? before.fileSize;
  do {
    const after = await snapshot(workspace, sessionId, { fromByteOffset });
    if (hasNewTranscriptUserRecord(before, after)) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  const after = await snapshot(workspace, sessionId, { fromByteOffset });
  return hasNewTranscriptUserRecord(before, after);
}

export async function deliverResumeMessageWithTranscriptConfirmation(args: {
  agentId: string;
  workspace: string;
  sessionId: string;
  message: string;
  caller: string;
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';
  timeoutMs?: number;
  intervalMs?: number;
  deliver?: typeof deliverAgentMessage;
  snapshot?: typeof captureTranscriptUserRecordSnapshot;
}): Promise<{ delivered: boolean; attempts: number; lastDelivery?: DeliveryResult }> {
  const snapshot = args.snapshot ?? captureTranscriptUserRecordSnapshot;
  const deliver = args.deliver ?? deliverAgentMessage;
  const before = await snapshot(args.workspace, args.sessionId);
  let lastDelivery: DeliveryResult | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    lastDelivery = await deliver(args.agentId, args.message, args.caller, args.deliveryMethod);
    if (lastDelivery.ok && await waitForTranscriptUserRecordLanding(
      args.workspace,
      args.sessionId,
      before,
      snapshot,
      args.timeoutMs,
      args.intervalMs,
    )) {
      return { delivered: true, attempts: attempt, lastDelivery };
    }
    if (attempt < 2) {
      console.warn(`[resumeAgent] Auto-continue prompt did not land in ${args.sessionId}; redelivering once.`);
    }
  }

  return { delivered: false, attempts: 2, ...(lastDelivery ? { lastDelivery } : {}) };
}

async function deliverInitialPromptWithRetry(
  agentId: string,
  prompt: string,
  caller: string,
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<DeliveryResult> {
  // PAN-1803: the codex TUI mangles a large pasted kickoff prompt — a multi-
  // thousand-character paste garbles its input and trips its "Create a plan?"
  // mode hint, so the agent never executes. Write the full brief to a file and
  // deliver a SHORT pointer instead (robust regardless of transport — the same
  // pattern that makes file-backed handoffs reliable). Only codex needs this;
  // claude-code/pi line-based input handle the full prompt fine.
  let deliveredPrompt = prompt;
  try {
    const codexState = await Effect.runPromise(getAgentState(normalizeAgentId(agentId)));
    if (codexState?.harness === 'codex' && codexState.workspace) {
      const kickoffPath = join(codexState.workspace, '.pan', 'kickoff.md');
      mkdirSync(dirname(kickoffPath), { recursive: true });
      writeFileSync(kickoffPath, prompt, 'utf-8');
      deliveredPrompt =
        'Your complete task brief has been written to `.pan/kickoff.md` in this workspace. '
        + 'Read that file in full now and execute it exactly — it is your full set of work '
        + 'instructions. Begin immediately and keep working autonomously until done; do not '
        + 'wait for further input.';
    }
  } catch {
    // Non-fatal: fall back to delivering the full prompt inline.
  }

  let lastFailure = 'not-attempted';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let harness: RuntimeName | undefined;
    try {
      harness = (await Effect.runPromise(getAgentState(normalizeAgentId(agentId))))?.harness;
    } catch {
      harness = undefined;
    }
    const readyTimeoutSeconds = promptReadyTimeoutSeconds();
    const ready = await waitForPromptReady(agentId, harness, readyTimeoutSeconds);
    if (!ready) {
      const alive = await Effect.runPromise(sessionExists(normalizeAgentId(agentId)));
      lastFailure = alive ? 'ready-signal-timeout' : SESSION_EXITED_BEFORE_KICKOFF;
      console.error(`[${agentId}] ${harness === 'codex' ? 'Codex' : 'Claude'} did not become ready within ${readyTimeoutSeconds}s (kickoff attempt ${attempt}/2)`);
      if (!alive) break;
      continue;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      const result = await deliverAgentMessage(agentId, deliveredPrompt, caller, deliveryMethod);
      if (result.ok) return result;
      lastFailure = result.failure ?? `delivery returned ok=false via ${result.path}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    console.error(`[${agentId}] Kickoff delivery attempt ${attempt}/2 failed: ${lastFailure}`);
  }

  return { ok: false, path: 'tmux', failure: lastFailure };
}

async function recordStartupSessionExit(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<never> {
  await Effect.runPromise(recordAgentFailure(state.id, SESSION_EXITED_BEFORE_KICKOFF));
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'stopped';
    failedState.stoppedAt = new Date().toISOString();
    failedState.kickoffDelivered = false;
    failedState.lastFailureReason = SESSION_EXITED_BEFORE_KICKOFF;
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.kickoffDelivered = false;
  state.lastFailureReason = SESSION_EXITED_BEFORE_KICKOFF;
  emitActivityEntrySync({
    source,
    level: 'error',
    message: `${state.id}: session exited before kickoff could be delivered`,
    issueId,
  });
  throw new Error(`Agent ${state.id} exited before kickoff could be delivered`);
}

export function buildDefaultResumeContinueMessage(issueId: string): string {
  return `You are resuming work on ${issueId}. Read .pan/continue.json for context and pick up where you left off — do not wait for further instructions.`;
}

async function buildResumeMessageForAgent(
  state: AgentState,
  fallbackMessage: string,
  callerMessage?: string,
): Promise<{ message?: string; redeliveringKickoff: boolean; error?: string }> {
  if (state.role !== 'work' || state.kickoffDelivered !== false) {
    return { message: callerMessage ?? fallbackMessage, redeliveringKickoff: false };
  }

  const promptPath = join(getAgentDir(state.id), 'initial-prompt.md');
  try {
    const kickoffPrompt = await readFile(promptPath, 'utf-8');
    const suffix = callerMessage
      ? `\n\n---\n\nAdditional message delivered during resume:\n\n${callerMessage}`
      : '';
    return { message: `${kickoffPrompt}${suffix}`, redeliveringKickoff: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      redeliveringKickoff: true,
      error: `kickoff prompt missing at ${promptPath}: ${reason}`,
    };
  }
}

function markKickoffRedelivered(state: AgentState): void {
  state.kickoffDelivered = true;
  saveAgentStateSync(state);
}

async function recordKickoffDeliveryFailure(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<void> {
  await Effect.runPromise(recordAgentFailure(state.id, 'kickoff delivery failed'));
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'running';
    failedState.kickoffDelivered = false;
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'running';
  state.kickoffDelivered = false;
  emitActivityEntrySync({
    source,
    level: 'error',
    message: `${state.id}: kickoff delivery failed`,
    issueId,
  });
}

export async function deliverAgentPermissionDecision(
  agentId: string,
  requestId: string,
  behavior: 'allow' | 'deny',
): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  let state: AgentState | null = null;
  try {
    state = await Effect.runPromise(getAgentState(normalizedId));
  } catch {
    state = null;
  }

  if (!state?.channelsEnabled) {
    throw new Error(`agent ${normalizedId} is not using Claude channels`);
  }

  const socketPath = join(overdeckHomeForChannels(), 'sockets', `agent-${normalizedId}.sock`);
  if (!existsSync(socketPath)) {
    throw new Error(`bridge socket missing for ${normalizedId}`);
  }

  const bridgeToken = readBridgeTokenSync(normalizedId);
  if (!bridgeToken) {
    throw new Error(`bridge token missing for ${normalizedId}`);
  }

  await postUnixSocketJson(
    socketPath,
    {
      type: 'permission_response',
      requestId,
      behavior,
    },
    2000,
    bridgeToken,
  );

  await appendChannelDeliveryLog(normalizedId, {
    path: 'channel',
    caller: `permission-response:${requestId}:${behavior}`,
  });
}

/**
 * Inputs to the channels eligibility decision. We pass through agentId,
 * SpawnOptions, and the in-construction AgentState so this function can be
 * called from the spawn path without re-reading the state file.
 */
interface ChannelsDecision {
  eligible: boolean;
  reason?: string;
}

interface SupervisorDecision {
  eligible: boolean;
  reason?: string;
}

export function decideSupervisorForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): SupervisorDecision {
  void options;
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'supervisor:eligible' : `supervisor:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (process.env.OVERDECK_DOCKER_WORKSPACE === '1' || process.env.PAN_DOCKER === '1') {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  if (state.harness !== 'claude-code' && state.harness !== 'codex') {
    const reason = `harness-${state.harness ?? 'unknown'}`;
    log(false, reason);
    return { eligible: false, reason };
  }

  log(true);
  return { eligible: true };
}

async function prepareSupervisorForFreshLaunch(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, options, state);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

async function prepareSupervisorForRelaunch(
  agentId: string,
  state: AgentState,
  model: string,
  harness: RuntimeName,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  if (state.supervisorEnabled !== true) {
    return { useSupervisor: false };
  }

  const relaunchState: AgentState = { ...state, model, harness };
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, {
    issueId: state.issueId || agentId.replace(/^agent-/, '').toUpperCase(),
    workspace: state.workspace,
    role: 'work',
    model,
    harness,
    allowHost: state.hostOverride,
  }, relaunchState);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

function resolvePtySupervisorScriptPath(): string {
  return join(packageRoot, 'dist', 'pty-supervisor.js');
}

/**
 * Decide whether to enable Claude Code Channels for a work-agent launch.
 *
 * Eligibility (all required):
 *   - experimental.claudeCodeChannelsMcp is true in the merged config
 *   - the agent is a work agent (specialists/conversations stay off MCP)
 *   - the harness is Claude Code (not Pi or another runtime harness)
 *   - auth provider is Anthropic-direct (excludes Bedrock/Vertex/Foundry)
 *   - the workspace is not running inside a Docker container
 *
 * Logs the decision exactly once with a category prefix so users can see why
 * the bridge did or did not engage. The function is otherwise side-effect
 * free; the caller is responsible for writing the .mcp.json and mutating
 * state.channelsEnabled when eligible is true. This legacy MCP transport is now
 * opt-in for new spawns; the PTY supervisor is the default delivery transport.
 */
export function decideChannelsForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): ChannelsDecision {
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'channels:eligible' : `channels:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (!isClaudeCodeChannelsMcpEnabled()) {
    return { eligible: false, reason: 'mcp-default-off' };
  }

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (state.harness !== 'claude-code') {
    log(false, `harness-${state.harness ?? 'unknown'}`);
    return { eligible: false, reason: `harness-${state.harness ?? 'unknown'}` };
  }

  // Auth gate. The Channels capability is gated by Anthropic auth in the
  // compiled Claude Code binary; we only attempt the bridge when the model
  // routes to the anthropic provider.
  const provider = getProviderForModelSync(state.model as ModelId);
  if (provider.name !== 'anthropic') {
    log(false, `provider-${provider.name}`);
    return { eligible: false, reason: `provider-${provider.name}` };
  }

  if (
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
    process.env.CLAUDE_CODE_USE_FOUNDRY === '1'
  ) {
    log(false, 'auth-bedrock-vertex-foundry');
    return { eligible: false, reason: 'auth-bedrock-vertex-foundry' };
  }

  // Docker workspace gate. We do not yet share a socket dir between host and
  // container; deferred to a follow-up issue (see hazards H10).
  if (
    process.env.OVERDECK_DOCKER_WORKSPACE === '1' ||
    process.env.PAN_DOCKER === '1'
  ) {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  log(true);
  return { eligible: true };
}

/**
 * Write the per-agent MCP config that points claude at the overdeck-bridge
 * stdio server. The path is the workspace-local <workspace>/.pan/agent-mcp.json
 * — one config per agent, never shared, never reused.
 */
export async function writeChannelsBridgeMcpConfig(
  configPath: string,
  agentId: string,
): Promise<void> {
  const fsp = await import('fs/promises');
  await fsp.mkdir(dirname(configPath), { recursive: true });
  // Resolve the bridge entrypoint from the project root. The source file
  // lives in src/lib/channels/ and is executed directly via `bun run`
  // (Bun runs TypeScript without pre-compilation). We must point at the
  // source, not a dist copy, because the build does not copy the bridge
  // script into the bundle output.
  const here = dirname(import.meta.url.replace('file://', ''));
  const projectRoot = join(here, '..', '..');
  const repoBridgePath = join(projectRoot, 'src', 'lib', 'channels', 'overdeck-bridge.ts');
  const mcpConfig = {
    mcpServers: {
      'overdeck-bridge': {
        command: 'bun',
        args: ['run', repoBridgePath],
        env: {
          OVERDECK_AGENT_ID: agentId,
          OVERDECK_HOME: process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck'),
        },
      },
    },
  };
  await fsp.writeFile(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
}

/**
 * Dismiss the dev-channels confirmation TUI dialog rendered by
 * `claude --dangerously-load-development-channels`. The dialog text
 * 'WARNING: Loading development channels' must be on screen before any prompt
 * is delivered, otherwise the channel listener never registers and every
 * early channel push silently falls back to tmux.
 *
 * Polling budget is 20s because cold-start claude with TLDR + Playwright MCP
 * servers attached commonly takes 8–15s to render the first frame; a tighter
 * budget false-negatives. If the dialog is not detected within the timeout,
 * we proceed — the dialog is suppressed in some auth states (e.g. when the
 * binary takes a non-interactive code path), and the launch must not block
 * forever.
 *
 * Uses sendRawKeystrokeAsync intentionally: sendKeysAsync's load-buffer +
 * paste-buffer machinery is for typing message bodies, not for a single
 * Enter on a TUI prompt where mistimed paste can fire before the dialog
 * accepts input.
 *
 * Once the dialog is detected we send Enter and KEEP checking — a single
 * keystroke can be dropped if the TUI is still mid-render, which left the
 * dialog on screen with the helper already returned. We re-send Enter every
 * RESEND_INTERVAL_MS until the needle is gone (bounded by DISMISS_BUDGET_MS).
 */
export async function dismissDevChannelsDialog(agentId: string): Promise<void> {
  const TIMEOUT_MS = 20_000;
  const POLL_INTERVAL_MS = 200;
  const RESEND_INTERVAL_MS = 150;
  const DISMISS_BUDGET_MS = 5_000;
  const NEEDLE = 'WARNING: Loading development channels';
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const pane = await Effect.runPromise(capturePane(agentId, 50));
      if (pane.includes(NEEDLE)) {
        // Dialog is up. Send Enter, then keep re-sending until the needle
        // clears — the first keystroke can land before the TUI is ready to
        // accept it, leaving the dialog stuck on screen.
        const dismissStart = Date.now();
        while (Date.now() - dismissStart < DISMISS_BUDGET_MS) {
          await Effect.runPromise(sendRawKeystroke(agentId, 'C-m', 'channels:dismiss-dev-dialog'));
          await new Promise((r) => setTimeout(r, RESEND_INTERVAL_MS));
          const after = await Effect.runPromise(
            capturePane(agentId, 50).pipe(Effect.catch(() => Effect.succeed(''))),
          );
          if (!after.includes(NEEDLE)) return;
        }
        console.log(`[${agentId}] channels:dismiss:dialog-still-present-after-budget`);
        return;
      }
    } catch {
      // Capture failures are transient (tmux session not yet visible to
      // the new pane); keep polling within the budget.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`[${agentId}] channels:dismiss:dialog-not-detected`);
}

function getAgentResumeGateBlockReason(state: Pick<AgentState, 'paused' | 'pausedReason' | 'troubled' | 'consecutiveFailures'>): string | undefined {
  if (state.paused === true) {
    return state.pausedReason
      ? `agent is paused (${state.pausedReason})`
      : 'agent is paused';
  }
  if (state.troubled === true) {
    const failures = state.consecutiveFailures ?? 0;
    return `agent is troubled (${failures} failure${failures === 1 ? '' : 's'})`;
  }
  return undefined;
}

function assertAgentCanTransitionToRunning(state: AgentState): void {
  const reason = getAgentResumeGateBlockReason(state);
  if (reason) {
    throw new Error(`Cannot run ${state.id}: ${reason}. Clear the gate before resuming.`);
  }
}

function markAgentRunning(state: AgentState, options?: { preserveFailureTracking?: boolean }): void {
  assertAgentCanTransitionToRunning(state);
  const oldStatus = state.status;
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  if (options?.preserveFailureTracking !== true) {
    clearFailureTrackingFields(state);
  }
  delete state.stoppedAt;
  // Clear user-stop intent so a later crash/orphan can be auto-resumed. Without
  // this the flag is sticky across the stop→resume→crash sequence and autoResume
  // would permanently skip the agent on any subsequent orphan recovery.
  delete state.stoppedByUser;
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → running (markAgentRunning)`);
}

function markAgentStopped(state: AgentState): void {
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.stoppedByUser = true;
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → stopped (markAgentStopped, user-initiated)`);
}

export function markAgentStoppedState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentStopped(state);
  return state;
}

export function markAgentRunningState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentRunning(state);
  return state;
}

/** Test-only internals. Do not import outside of test files. */
export const __testInternals = { markAgentRunning, markAgentStopped };

// ============================================================================
// Agent Runtime State (PAN-800: event-sourced, no more runtime.json)
// ============================================================================
//
// Persistence: append-only `events` SQLite table → AgentStateService's
// SubscriptionRef. The projection_cache write-through was removed in PAN-1847.
//
// Writes: emitAgentEvent POSTs to /api/agents/:id/heartbeat. Reads: in-process
// lib uses getRuntimeSnapshot (Effect-native); CLI/out-of-process uses
// getAgentRuntimeSnapshot (HTTP).
//
// The functions below are adapters over AgentRuntimeSnapshot. Each caller
// ideally uses the typed snapshot directly — the adapters exist because
// ~30 call sites across the cloister consumed the old shape and migrating
// every field access in one PR would have been mechanical noise.

import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import {
  getAgentRuntimeSnapshot as fetchAgentRuntimeSnapshot,
  emitAgentEvent,
} from './agent-runtime.js';
import { getRuntimeSnapshot, isAgentStateServiceInProcess } from './agent-runtime-mirror.js';
import { initCodexHome } from './runtimes/codex.js';

export type AgentResolution = 'working' | 'done' | 'needs_input' | 'stuck' | 'completed' | 'unclear' | 'abandoned';

/** Callers consume this shape; data comes from AgentRuntimeSnapshot. */
export interface AgentRuntimeState {
  // 'suspended' retained for backward-compat with callers that still compare
  // against it defensively. The new event path never emits suspended — PAN-800
  // drops the auto-suspend feature; PAN-188 reintroduces it.
  state: 'active' | 'idle' | 'suspended' | 'stopped' | 'uninitialized' | 'waiting-on-human';
  lastActivity: string;
  currentTool?: string;
  claudeSessionId?: string;
  sessionModel?: string;
  sessionHarness?: RuntimeName;
  /**
   * For specialists: the issue currently being processed. Tracked per-agent in
   * the AgentStateService snapshot (see agent.current_issue_set event).
   */
  currentIssue?: string;
  resolution?: AgentResolution;
  resolutionCount?: number;
  resolutionUpdatedAt?: string;
  waitingReason?: string;
  waitingStartedAt?: string;
  waitingNotification?: string;
  contextSaturatedAt?: string;
}

function sessionResumeDriftReasons(
  runtimeState: AgentRuntimeState | null,
  model: string,
  harness: RuntimeName,
): string[] {
  if (!runtimeState?.sessionModel || !runtimeState.sessionHarness) return [];
  const reasons: string[] = [];
  if (runtimeState.sessionModel !== model) {
    reasons.push(`model ${runtimeState.sessionModel}→${model}`);
  }
  if (runtimeState.sessionHarness !== harness) {
    reasons.push(`harness ${runtimeState.sessionHarness}→${harness}`);
  }
  return reasons;
}

function snapshotToRuntimeState(snap: AgentRuntimeSnapshot | null): AgentRuntimeState | null {
  if (!snap) return null;
  // Map Activity → legacy state. The legacy 'active' value collapses working
  // and thinking — neither consumer ever distinguished them.
  let state: AgentRuntimeState['state'];
  switch (snap.activity) {
    case 'working': state = 'active'; break;
    case 'thinking': state = 'active'; break;
    case 'idle': state = 'idle'; break;
    case 'stopped': state = 'stopped'; break;
    case 'waiting': state = 'waiting-on-human'; break;
    default: state = 'uninitialized';
  }
  return {
    state,
    lastActivity: snap.lastActivity,
    currentTool: snap.currentTool,
    claudeSessionId: snap.claudeSessionId,
    sessionModel: snap.sessionModel,
    sessionHarness: normalizeHarness(snap.sessionHarness ?? null) ?? undefined,
    currentIssue: snap.currentIssue,
    resolution: snap.resolution as AgentResolution | undefined,
    resolutionCount: snap.resolutionCount,
    resolutionUpdatedAt: snap.resolutionUpdatedAt,
    waitingReason: snap.waiting?.reason,
    waitingStartedAt: snap.waiting?.startedAt,
    waitingNotification: snap.waiting?.message,
    contextSaturatedAt: snap.contextSaturatedAt,
  };
}

export function getAgentRuntimeStateSync(agentId: string): AgentRuntimeState | null {
  // Sync path: read from the in-process mirror (empty in fresh CLI processes,
  // populated inside the dashboard server). CLI commands should use
  // getAgentRuntimeStateProgram so they fall through to HTTP.
  return snapshotToRuntimeState(Effect.runSync(getRuntimeSnapshot(agentId)));
}

export const getAgentRuntimeState = (agentId: string): Effect.Effect<AgentRuntimeState | null> =>
  Effect.gen(function* () {
    if (yield* isAgentStateServiceInProcess()) {
      return snapshotToRuntimeState(yield* getRuntimeSnapshot(agentId));
    }

    const snap = yield* fetchAgentRuntimeSnapshot(agentId);
    return snapshotToRuntimeState(snap);
  });

async function patchRuntimeJson(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  const agentDir = getAgentDir(agentId);
  const runtimeFile = join(agentDir, 'runtime.json');
  let runtime: Record<string, unknown> = {};

  try {
    runtime = JSON.parse(await readFile(runtimeFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    runtime = {};
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    if (patch.contextSaturatedAt === undefined) {
      delete runtime.contextSaturatedAt;
    } else {
      runtime.contextSaturatedAt = patch.contextSaturatedAt;
    }
  }

  await mkdir(agentDir, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify(runtime, null, 2));
}

/**
 * Emit events derived from a legacy-shape patch. Callers gradually migrate to
 * direct emitAgentEvent calls; this adapter keeps existing code working.
 */
export async function saveAgentRuntimeState(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  if (patch.currentIssue !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'current_issue_set',
      currentIssue: patch.currentIssue || undefined,
    }));
  }

  if (patch.resolution !== undefined && patch.resolutionCount !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'resolution_set',
      resolution: patch.resolution,
      resolutionCount: patch.resolutionCount,
    }));
  }

  if (patch.state !== undefined) {
    if (patch.state === 'waiting-on-human') {
      await Effect.runPromise(emitAgentEvent(agentId, {
        kind: 'waiting_start',
        reason: (patch.waitingReason as 'tool_permission' | 'user_question' | 'disambiguation' | 'other') || 'other',
        message: patch.waitingNotification,
      }));
    } else if (patch.state === 'active') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
    } else if (patch.state === 'idle') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'idle' }));
    } else if (patch.state === 'stopped') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'stopped' }));
    }
  } else if (patch.currentTool !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
  }

  if (patch.claudeSessionId || patch.sessionModel !== undefined || patch.sessionHarness !== undefined) {
    // model_set requires a model — use existing snapshot's model if present.
    const snap = getAgentRuntimeStateSync(agentId);
    if (snap || patch.claudeSessionId || patch.sessionModel !== undefined || patch.sessionHarness !== undefined) {
      const event: {
        kind: 'model_set';
        model: string;
        claudeSessionId?: string;
        sessionModel?: string;
        sessionHarness?: RuntimeName;
      } = {
        kind: 'model_set',
        model: 'unknown',
      };
      if (patch.claudeSessionId !== undefined) event.claudeSessionId = patch.claudeSessionId;
      if (patch.sessionModel !== undefined) event.sessionModel = patch.sessionModel;
      if (patch.sessionHarness !== undefined) event.sessionHarness = patch.sessionHarness;
      await Effect.runPromise(emitAgentEvent(agentId, {
        ...event,
      }));
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    await patchRuntimeJson(agentId, patch);
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'context_saturation_changed',
      contextSaturatedAt: patch.contextSaturatedAt,
    }));
  }
}

/** Activity log entry (still written by heartbeat-hook as a forensic artifact). */
export interface ActivityEntry {
  ts: string;
  tool: string;
  action?: string;
  state?: 'active' | 'idle';
}

/**
 * Append to activity log with automatic pruning to 100 entries
 */
export function appendActivity(agentId: string, entry: ActivityEntry): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  const activityFile = join(dir, 'activity.jsonl');

  // Append entry
  appendFileSync(activityFile, JSON.stringify(entry) + '\n');

  // Prune to last 100 entries
  if (existsSync(activityFile)) {
    try {
      const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
      if (lines.length > 100) {
        const trimmed = lines.slice(-100);
        writeFileSync(activityFile, trimmed.join('\n') + '\n');
      }
    } catch (error) {
      // Ignore pruning errors - activity log is non-critical
    }
  }
}

/**
 * Read activity log (last N entries)
 */
export function getActivity(agentId: string, limit = 100): ActivityEntry[] {
  const activityFile = join(getAgentDir(agentId), 'activity.jsonl');

  if (!existsSync(activityFile)) {
    return [];
  }

  try {
    const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
    const entries = lines
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ActivityEntry)
      .slice(-limit);

    return entries;
  } catch {
    return [];
  }
}

/**
 * Save Claude session ID for later resume
 */
export function saveSessionId(agentId: string, sessionId: string): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'session.id'), sessionId);
}

/**
 * Get saved Claude session ID
 */
export function getSessionId(agentId: string): string | null {
  const sessionFile = join(getAgentDir(agentId), 'session.id');

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    return readFileSync(sessionFile, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Get the latest Claude session ID from any available source.
 * Checks session.id first (written by suspend), then sessions.json (written by heartbeat hook),
 * then runtime.json claudeSessionId field.
 */
/**
 * PAN-1988 — for a codex agent, resolve its REAL resumable thread id. codex writes a placeholder
 * UUID into `session.id` at spawn; the resumable id is the codex thread, recorded in the rollout.
 * Prefer the explicitly-captured `codex-thread-id`, then fall back to the freshest rollout on disk
 * (always current — codex writes a new rollout per resume, so this self-heals across resume cycles
 * without depending on the capture poll landing). Returns null for non-codex agents.
 */
function resolveCodexThreadIdSync(agentId: string): string | null {
  const agentDir = getAgentDir(agentId);
  const codexHome = join(agentDir, 'codex-home');
  if (!existsSync(codexHome)) return null; // not a codex agent
  try {
    const threadIdPath = join(agentDir, 'codex-thread-id');
    if (existsSync(threadIdPath)) {
      const id = readFileSync(threadIdPath, 'utf-8').trim();
      if (id) return id;
    }
  } catch { /* non-fatal */ }
  try {
    const rollout = findLatestRollout(codexHome);
    if (rollout) {
      const id = extractThreadIdFromRollout(rollout);
      if (id) return id;
    }
  } catch { /* non-fatal */ }
  return null;
}

/**
 * Sync mirror of jsonl-resolver.ts's pickFreshestSessionId: from a list of
 * candidate session ids, return the one whose JSONL transcript has the most
 * recent mtime, skipping ids with no file on disk. Falls back to the last
 * appended id when none have a transcript (e.g. workspace moved). Returns null
 * only when there are no usable candidates.
 */
function pickFreshestExistingSessionIdSync(agentId: string, candidates: unknown[]): string | null {
  const valid = candidates.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (valid.length === 0) return null;
  const workspace = getAgentStateSync(agentId)?.workspace;
  if (workspace) {
    const projectDir = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspace));
    let best: { id: string; mtimeMs: number } | null = null;
    for (const id of valid) {
      try {
        const s = statSync(join(projectDir, `${id}.jsonl`));
        if (!best || s.mtimeMs > best.mtimeMs) best = { id, mtimeMs: s.mtimeMs };
      } catch { /* no JSONL for this id — skip */ }
    }
    if (best) return best.id;
  }
  return valid[valid.length - 1] ?? null;
}

export function getLatestSessionIdSync(agentId: string): string | null {
  // 0. codex thread id FIRST — `session.id` below holds a placeholder UUID for codex agents, so
  //    returning it would make resumeAgent target a non-existent thread and codex would drift into
  //    a fresh rollout, losing conversation history (PAN-1988). The freshest rollout is the truth.
  const codexThreadId = resolveCodexThreadIdSync(agentId);
  if (codexThreadId) return codexThreadId;

  // 1. session.id (written by auto-suspend) — the real id for claude-code.
  const fromSessionFile = getSessionId(agentId);
  if (fromSessionFile) return fromSessionFile;

  // 2. sessions.json (append-only list of session ids the agent has used).
  //    The array can hold aborted/empty ids (e.g. a fresh session that never
  //    produced a transcript), so we can't trust "last entry" — pick the id
  //    whose JSONL is freshest on disk, matching resolveClaudeSessionId
  //    (jsonl-resolver.ts). Falls back to last-appended when none exist on disk.
  const sessionsFile = join(getAgentDir(agentId), 'sessions.json');
  try {
    if (existsSync(sessionsFile)) {
      const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
      if (Array.isArray(sessions) && sessions.length > 0) {
        const picked = pickFreshestExistingSessionIdSync(agentId, sessions);
        if (picked) return picked;
      }
    }
  } catch { /* non-fatal */ }

  // 3. runtime.json claudeSessionId
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (runtimeState?.claudeSessionId) {
    return runtimeState.claudeSessionId;
  }

  // 4. codex-thread-id (written after codex rollout appears; fallback so
  //    resumeAgent can locate the Codex session even if session.id has a
  //    stale random UUID from spawnRun's placeholder write).
  const codexThreadIdPath = join(getAgentDir(agentId), 'codex-thread-id');
  try {
    if (existsSync(codexThreadIdPath)) {
      const threadId = readFileSync(codexThreadIdPath, 'utf-8').trim();
      if (threadId) return threadId;
    }
  } catch { /* non-fatal */ }

  // 5. ohmypi (omp) — PAN-2098. omp never writes a `session.id` file, so none of
  //    the claude-code/codex sources above can find it; the real id lives inside
  //    the freshest session JSONL. Mirror the ohmypi runtime adapter's own resume
  //    resolution so the deacon recovery path can resume a crashed ohmypi agent
  //    instead of only respawning it fresh and losing context.
  if (getAgentStateSync(agentId)?.harness === 'ohmypi') {
    const ohmypiSessionId = resolveLatestOhmypiSessionId(agentId);
    if (ohmypiSessionId) return ohmypiSessionId;
  }

  return null;
}

export const getLatestSessionId = (agentId: string): Effect.Effect<string | null> => {
  const agentDir = getAgentDir(agentId);
  const sessionFile = join(agentDir, 'session.id');
  const sessionsFile = join(agentDir, 'sessions.json');

  return Effect.gen(function* () {
    const sessionId = yield* Effect.tryPromise({
      try: () => readFile(sessionFile, 'utf8'),
      catch: (cause) => toAgentFsError('read', sessionFile, cause),
    }).pipe(
      Effect.map((content) => content.trim()),
      Effect.orElseSucceed(() => ''),
    );
    if (sessionId) return sessionId;

    const latestSession = yield* Effect.tryPromise({
      try: async () => JSON.parse(await readFile(sessionsFile, 'utf8')) as unknown,
      catch: (cause) => toAgentFsError('read', sessionsFile, cause),
    }).pipe(
      Effect.map((sessions) => Array.isArray(sessions) && sessions.length > 0 ? String(sessions[sessions.length - 1]) : null),
      Effect.orElseSucceed(() => null),
    );
    if (latestSession) return latestSession;

    const runtimeState = yield* getAgentRuntimeState(agentId);
    return runtimeState?.claudeSessionId ?? null;
  });
};

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  /** Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted. */
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  /**
   * Spawn role. Defaults to 'work'. The 'strike' role is the bypass path that
   * skips plan/review/test/ship and lands directly on main — see roles/strike.md.
   * Strike sessions are named `strike-<issue-id>` instead of `agent-<issue-id>`.
   */
  role?: 'work' | 'strike';
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Explicit work type ID (overrides phase-based detection)

  // PAN-1517: swarm slot fields removed (slotId, swarmItemId). Parallelism
  // is now in-context via subagents (see roles/work.md), not via slot agents.
  // `allowHost` (workspace-isolation override) stays — it predates the swarm
  // runtime and is used by review/test/ship agents independently.
  allowHost?: boolean;
  flywheelRunId?: string;
  /** Claude Code `--effort` level for the spawned session (work/strike). */
  effort?: RoleEffort;
}

export interface SpawnRunOptions {
  workspace?: string;
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  agentId?: string;
  /**
   * Sub-role within the review convoy (PAN-1059).
   * When set alongside role='review', each convoy reviewer gets its own
   * isolated tmux session using the code-review-<subRole> agent definition.
   * Values: 'security' | 'correctness' | 'performance' | 'requirements'
   */
  subRole?: string;
  /**
   * Review convoy wiring (PAN-977). When spawning a review sub-role, the
   * synthesis agent id and the reviewer's output path are passed in up front
   * so the generated launcher can own the REVIEWER_READY/FAILED/TIMEOUT signal
   * deterministically on process exit. Persisted onto AgentState too.
   */
  reviewSynthesisAgentId?: string;
  reviewOutputPath?: string;
  allowHost?: boolean;
  registerConversation?: boolean;
  effort?: RoleEffort;
  resumeSessionId?: string;
  flywheelRunId?: string;
}

/**
 * Build shell export lines to inject into a work agent's launcher.sh.
 *
 * Sets CAVEMAN_DEFAULT_MODE and OVERDECK_CAVEMAN_VARIANT so the caveman
 * SessionStart hook activates at the right intensity level and cost events
 * carry the A/B test variant.
 *
 * @param workspacePath  Absolute workspace path (to read stored variant)
 * @param config         Normalized caveman config from YamlConfig
 * @param isPlanning     True for planning agents — caveman always disabled there
 * @returns              Shell export lines to prepend to the launcher script
 */
export async function buildCavemanExports(
  workspacePath: string,
  config: NormalizedCavemanConfig,
  isPlanning: boolean
): Promise<string> {
  // Planning agents: never compress — output is user-facing
  if (isPlanning || !config.enabled) return '';

  const variant = await Effect.runPromise(readCavemanVariant(workspacePath));

  // If this workspace's A/B variant is 'disabled', set variant for tracking but no mode
  if (variant === 'off') return '';
  if (variant === 'disabled') {
    return `export OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
  }

  // Work agents use the 'work' intensity mode
  const mode = config.modes.work;
  if (mode === 'off' || mode === 'disabled') return '';

  return `export CAVEMAN_DEFAULT_MODE="${mode}"\nexport OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
}

/**
 * Determine which model to use for a role-based work agent.
 *
 * Priority:
 * 1. Explicitly provided model (options.model)
 * 2. Role routing via config.yaml roles/workhorses (defaults to work)
 *
 * Resolution failures propagate as spawn-time errors. Per PAN-1048 PRD:
 * invalid workhorse references and unresolved role configs must fail loudly
 * at config-load/spawn time, not silently fall back to a hidden default
 * model. Defaults are seeded into the config when entries are absent
 * (DEFAULT_WORKHORSES / DEFAULT_ROLES) — anything that still raises here
 * is a real configuration bug the user must see.
 */
/**
 * Models that are known-broken for autonomous *work* agents and must never be
 * used to spawn one, even if a project pins them in config. The gate fails
 * loudly for the work role when the model wasn't an explicit per-spawn override.
 *
 * Empty as of PAN-1584: gpt-5.5 used to wedge at launch with CLIProxy "System
 * messages are not allowed", which was a stale CLIProxyAPI binary (6.9.45)
 * mis-translating Claude Code's request to the Codex backend. Upgrading the
 * pinned CLIProxyAPI to v7.1.39 (+ a version-aware installer) fixed it; gpt-5.5
 * work agents now launch clean under the claude-code harness. The mechanism is
 * retained for any future known-broken model. (Pi-harness gpt-5.5 was not
 * re-verified in this pass — re-add 'gpt-5.5' here if a Pi init hang resurfaces.)
 */
const WORK_AGENT_BROKEN_MODELS = new Set<string>([]);

export function determineModel(options: { model?: string; role?: Role; spawnKey?: string } = {}): string {
  const modelOverride = normalizeModelOverrideSync(options.model);
  const resolved = modelOverride
    ? modelOverride
    : requireModelOverrideSync(resolveModel(options.role ?? 'work', undefined, loadYamlConfig().config, options.spawnKey));

  // Work-agent safety net: a config pin (or smart-selection) must not spawn a
  // work agent on a model that is known to wedge for the work role. Fail loudly
  // rather than launch a dead agent or silently substitute another model. Only
  // applies to the work role and only when the model wasn't an explicit,
  // deliberate per-spawn override.
  const role = options.role ?? 'work';
  if (role === 'work' && !modelOverride && WORK_AGENT_BROKEN_MODELS.has(resolved)) {
    throw new Error(
      `Resolved work model "${resolved}" is known-broken for work agents. ` +
      'Set roles.work.model to a working model in config.yaml, or pass an explicit --model override.',
    );
  }

  return resolved;
}

/**
 * Shared tracker resolution logic for issue state transitions.
 *
 * Resolution order (by project tracker type):
 * 1. github_repo → GitHub Issues (takes priority over issue_prefix, since projects
 *    like overdeck use GitHub Issues with a prefix, not Linear)
 * 2. rally_project → Rally
 * 3. issue_prefix (no github_repo) → Linear (covers gitlab+linear and pure-linear projects)
 * 4. gitlab_repo only → warn and skip (GitLab doesn't support label-based state transitions)
 *
 * Precedence rationale: issue_prefix was renamed from linear_team but is now also set on
 * GitHub-hosted projects (e.g. issue_prefix: PAN for overdeck GitHub Issues).
 * github_repo must be checked first so GitHub projects don't misroute to Linear.
 */
async function transitionIssueState(issueId: string, state: IssueState, workspacePath?: string): Promise<void> {
  // Guard: bare numeric IDs (no alphabetic prefix, e.g. "484") must never reach
  // any tracker API. Linear's searchIssues("484") would match MIN-484 in the wrong
  // team. Log a warning and skip — the workspace's project must use prefixed IDs.
  if (/^\d+$/.test(issueId)) {
    console.warn(
      `[agents] Skipping ${state} transition for bare numeric ID "${issueId}" — ` +
      `issue IDs must include a project prefix (e.g. PAN-${issueId}). ` +
      `This workspace was likely created before the pan- prefix convention.`
    );
    return;
  }

  // Resolve the project from workspacePath — its configured tracker is authoritative.
  // Every issue MUST belong to a registered project with a tracker configured.
  const projectConfig = workspacePath ? findProjectByPathSync(workspacePath) : null;
  if (!projectConfig) {
    throw new Error(`Cannot transition ${issueId}: no project config found for workspace ${workspacePath || '(none)'}. Register the project in projects.yaml.`);
  }

  // Project has a GitHub repo — use GitHub Issues tracker.
  // Checked BEFORE issue_prefix because github_repo projects (e.g. overdeck)
  // set issue_prefix for their GitHub Issue prefix (PAN-), not for Linear.
  if (projectConfig.github_repo) {
    const [owner, repo] = projectConfig.github_repo.split('/');
    const tracker = createTracker({ type: 'github', owner, repo });
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via GitHub (${projectConfig.github_repo})`);
    return;
  }

  // Project has a Rally project — use Rally tracker
  if (projectConfig.rally_project) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.rally) {
      throw new Error(`Project ${projectConfig.name} uses Rally (project: ${projectConfig.rally_project}) but no Rally tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'rally');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Rally (project: ${projectConfig.rally_project})`);
    return;
  }

  // Project has a Linear team prefix (and no github_repo) — use Linear tracker.
  // This covers: pure-Linear projects and gitlab+Linear projects (e.g. mind-your-now).
  if (getIssuePrefix(projectConfig)) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.linear) {
      throw new Error(`Project ${projectConfig.name} uses Linear (team: ${getIssuePrefix(projectConfig)}) but no Linear tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'linear');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Linear (team: ${getIssuePrefix(projectConfig)})`);
    return;
  }

  if (projectConfig.gitlab_repo) {
    console.warn(`[agents] GitLab project detected (${projectConfig.gitlab_repo}) but GitLab does not support ${state} label transitions`);
    return;
  }

  throw new Error(`Project ${projectConfig.name} has no tracker configured (need issue_prefix, github_repo, or rally_project in projects.yaml)`);
}

export async function transitionIssueToInProgress(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_progress', workspacePath);
}

/**
 * Transitions an issue to "in_review" state in the configured issue tracker.
 * Fire-and-forget — logs warnings on failure but never blocks the pipeline.
 */
export async function transitionIssueToInReview(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_review', workspacePath);
}

export interface AgentLaunchConfig {
  launcherContent: string;
  providerEnv: Record<string, string>;
}

export async function buildAgentLaunchConfig(opts: {
  agentId: string;
  model: string;
  workspace: string;
  role: Role;
  spawnMode?: 'resume';
  resumeSessionId?: string;
  isPlanning?: boolean;
  /** Per-agent .mcp.json path for the experimental Channels bridge. */
  channelsBridgeMcpConfig?: string;
  /** MCP server name to load as a Channel; defaults to 'overdeck-bridge'. */
  channelsBridgeServerName?: string;
  useSupervisor?: boolean;
  supervisorScriptPath?: string;
  /** Claude Code session id for fresh launches that need a known id before boot. */
  sessionId?: string;
  /**
   * Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted —
   * preserves bit-for-bit pre-PAN-636 behavior. When 'pi', the launcher is
   * built via the Pi command-line generator instead of the claude path; opts
   * like agentId-as-name and agent-frontmatter are ignored because Pi has
   * no agent-definition system.
   */
  harness?: RuntimeName;
  extraEnvExports?: string[];
  /** Claude Code `--effort` level threaded into the launcher command. */
  effort?: RoleEffort;
  /** Inline prompt to embed in launch commands that still support prompt arguments. */
  promptInline?: string;
}): Promise<AgentLaunchConfig> {
  const model = requireModelOverrideSync(opts.model);

  // Substrate guard: inject permission deny rules for Overdeck infrastructure
  // paths (.claude/agents/, .claude/hooks/, ~/.overdeck/, JSONL session dirs)
  // into the workspace's .claude/settings.local.json. Idempotent. Without this
  // a vBRIEF action like "delete the legacy pan-*-agent.md files" can convince
  // an agent to brick its own runtime. PAN-1048 X1 incident, 2026-05-09.
  try {
    const { injectOverdeckInfraDeny } = await import('./claude-settings-overlay.js');
    await Effect.runPromise(injectOverdeckInfraDeny(opts.workspace));
  } catch (err) {
    console.warn(`[agents] injectOverdeckInfraDeny failed for ${opts.agentId} (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModelSync(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, opts.workspace);
  } else {
    clearCredentialFileAuthSync(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  // PAN-1048: resume/restart launchers must respect the agent's role.
  // A resumed review/test/ship run loads the wrong frontmatter (and wrong
  // tool permissions) if it always points at roles/work.md.
  const launchRole: Role = opts.isPlanning ? 'plan' : opts.role;

  // PAN-1055: ohmypi harness needs --session-dir + fifo redirect threaded into
  // the launcher; getOhmypiLauncherFields() resolves them from the agent state
  // and they're spread into generateLauncherScript() below.
  // PAN-1574: codex harness needs its per-agent CODEX_HOME path.
  const piLauncherFields = opts.harness === 'ohmypi'
    ? await getOhmypiLauncherFields(opts.agentId, model)
    : {};
  const codexLauncherFields = opts.harness === 'codex'
    ? getCodexLauncherFields(opts.agentId, model, opts.workspace)
    : {};

  if (opts.spawnMode === 'resume' && opts.resumeSessionId) {
    // Resume sessions adopt the role definition via --agent.
    // Permissions/model/tools/hooks come from roles/<role>.md frontmatter.
    // --name <agentId> gives the resumed Claude session a human-readable handle.
    //
    // The frontmatter's permissionMode: bypassPermissions only bypasses prompts
    // INSIDE cwd. Tools that touch siblings of cwd (e.g. bd reading
    // .beads/issues.jsonl through git subprocesses, pan reading
    // ~/.overdeck/...) still hit "Do you want to proceed?" without DSP.
    // Mid-Bash dialog dismissals (deacon nudge, paste-buffer write, sibling
    // hook output) cancel the in-flight tool call and surface as
    // `Interrupted · What should Claude do instead?` (PAN-1024 reproduced
    // this loop on every fresh resume of PAN-1044/PAN-934).
    //
    // Match the fresh-spawn path: when permissionMode resolves to 'bypass'
    // (PAN_YOLO=true OR claude.permissionMode=bypass in config), prepend
    // --dangerously-skip-permissions on resume too.
    // Use the shared helper so the only string literal for DSP lives in
    // claude-permissions.ts (see scripts/lint-permissions.sh allowlist).
    const launcherContent = generateLauncherScriptSync({
      role: launchRole,
      spawnMode: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      // PAN-2087: claude-code resumes inject the role body (+ effort) as an
      // appended system prompt instead of `--agent <file>` (Claude Code 2.1.195
      // dropped --agent file support); permission flags come from the global
      // resolver. ohmypi/codex resumes route through getAgentRuntimeBaseCommand
      // which short-circuits to the omp/codex form.
      baseCommand: opts.harness === 'ohmypi' || opts.harness === 'codex'
        ? await getAgentRuntimeBaseCommand(model, opts.agentId, launchRole, opts.harness)
        : `claude ${getClaudePermissionFlagsStringSync()}${roleSystemPromptInjectionSync(roleAgentDefinitionPath(launchRole))}`,
      resumeSessionId: opts.resumeSessionId,
      model: opts.harness === 'ohmypi' || opts.harness === 'codex' || providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
      extraArgs: opts.harness === 'ohmypi' || opts.harness === 'codex' ? undefined : `--name ${opts.agentId}`,
      appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
      extraEnvExports: opts.extraEnvExports,
      useSupervisor: opts.useSupervisor,
      supervisorScriptPath: opts.supervisorScriptPath,
      promptInline: opts.promptInline,
      ...piLauncherFields,
      ...codexLauncherFields,
    });
    return { launcherContent, providerEnv };
  }

  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    opts.workspace,
    yamlConfig.config.caveman,
    opts.isPlanning ?? false,
  );

  // PAN-982: pass the role definition path + agentId through getAgentRuntimeBaseCommand so it
  // emits 'claude --agent roles/<role>.md --name <agentId>'.
  // PAN-636: when harness === 'pi' the helper short-circuits to a pi --mode rpc
  // line and the agentName/agentDefinition arguments are ignored (Pi has no agent
  // definitions). The launcher generator's pi branch then layers --session-dir
  // and the fifo redirect on top.
  const agentDefinition = roleAgentDefinitionPath(launchRole);
  const launcherContent = generateLauncherScriptSync({
    role: launchRole,
    workingDir: opts.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model, opts.agentId, agentDefinition, opts.harness ?? 'claude-code', opts.effort),
    sessionId: opts.harness === 'claude-code' ? opts.sessionId : undefined,
    appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
    extraEnvExports: opts.extraEnvExports,
    useSupervisor: opts.useSupervisor,
    supervisorScriptPath: opts.supervisorScriptPath,
    promptInline: opts.promptInline,
    ...piLauncherFields,
    ...codexLauncherFields,
    ...(opts.channelsBridgeMcpConfig
      ? {
          channelsBridgeMcpConfig: opts.channelsBridgeMcpConfig,
          channelsBridgeServerName: opts.channelsBridgeServerName ?? 'overdeck-bridge',
        }
      : {}),
  });

  return { launcherContent, providerEnv };
}

function defaultRunWorkspace(issueId: string): string {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) {
    throw new Error(`Cannot spawn role run for ${issueId}: no project is configured for this issue prefix`);
  }
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

export async function retrieveSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  if (!input.prompt.trim()) return '';

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(input.workspace),
      workspaceId: basename(input.workspace),
      issueId: input.issueId,
      runId: input.agentId,
      sessionId: input.agentId,
      agentRole: input.role,
      agentHarness: input.harness,
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    return (await injectPromptTimeMemory({ prompt: input.prompt, identity, surface: 'spawn' })).context;
  } catch (error) {
    console.warn(`[agents] Spawn-time memory context unavailable for ${input.agentId}:`, error instanceof Error ? error.message : String(error));
    return '';
  }
}

async function withSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  const context = await retrieveSpawnTimeMemoryContext(input);
  return context ? `${context}\n\n---\n\n${input.prompt}` : input.prompt;
}

function inferMemoryProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return workspaceName;
}

function runAgentId(issueId: string, role: Role, subRole?: string): string {
  const base = role === 'work'
    ? `agent-${issueId.toLowerCase()}`
    : `agent-${issueId.toLowerCase()}-${role}`;
  return subRole ? `${base}-${subRole}` : base;
}

/**
 * Spawn-time stack-rebuild self-heal state. PAN-1618: the work-spawn gate
 * (`assertWorkspaceStackHealthyForSpawn`) used to fail hard when the workspace
 * docker stack was down, with only manual recoveries (`pan workspace rebuild`
 * or interactive `--host`). Under autonomous operation a fully-planned
 * `proposed` item whose stack happened to be down could never auto-start its
 * work agent — it sat at the gate forever. This mirrors the PAN-1247
 * orphan-test self-heal one role earlier: rebuild the stack before failing,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const spawnStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean; hostFallbackNoticed?: boolean }> =
  new Map();
const SPAWN_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const SPAWN_STACK_REBUILD_MAX_ATTEMPTS = 3;

/**
 * Spawn a role-based Overdeck run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan') return;

  // PAN-1872: guard against an undefined issueId so workspace health checks do
  // not crash with `Cannot read properties of undefined (reading 'toUpperCase')`
  // while pan start is recovering from a sync-main conflict.
  const normalizedIssue = (issueId ?? '').toUpperCase();

  // PAN-1746: absence of a workspace must be a HARDER failure than an unhealthy
  // one. The host-fallback path below lets advancing roles (review/test/ship)
  // proceed when the docker stack is merely unhealthy — but a workspace
  // directory that does not exist at all means the launcher would fall back to
  // its cwd ($HOME) and wedge Claude at the folder-trust prompt while it holds
  // an advancing slot against the PAN-1665 governor. Refuse the spawn outright
  // instead of degrading to host. (`work`'s resume path already guards this in
  // restartAgent; this closes the same gap on the role-run spawn path.)
  if (workspacePath && !existsSync(workspacePath)) {
    throw new Error(
      `Workspace for ${normalizedIssue} does not exist at ${workspacePath} — refusing to spawn ${role}. `
      + `A missing workspace would land the agent in $HOME at the folder-trust prompt. `
      + `Recreate the workspace ('pan workspace rebuild ${normalizedIssue}') before retrying.`,
    );
  }

  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    spawnStackRebuildState.delete(normalizedIssue);
    return;
  }

  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host to override.`;

  if (allowHost) {
    // PAN-1556: host-override is a per-spawn detail, not user-facing activity —
    // it fired once per convoy member and buried real feed items (conversations).
    // Keep the console.warn for debugging; do not emit to the session feed.
    console.warn(`[agents] ${message}`);
    return;
  }

  // PAN-1645 + PAN-1618: an unhealthy stack must NEVER *block* the advancing
  // roles. review/test/ship all operate on the HOST workspace — ship
  // rebases/pushes against the host .git, review reads the committed diff, and
  // test runs the project's quality gates (host-run unless a gate explicitly
  // opts into a container) — so they do not need the workspace's docker
  // containers at all. The long-standing manual `--host` workaround (PAN-1645)
  // burned enormous effort just rediscovering that ship-on-broken-docker is a
  // false gate. For these roles we still attempt one bounded autonomous rebuild
  // (so a project whose test gates DO run in containers gets a healthy stack
  // when recoverable), but if it can't be made healthy we AUTO-FALL-BACK TO
  // HOST and proceed instead of throwing.
  //
  // `work` is different: a work agent may rely on the dev container's services,
  // so silently running it on the host could build/test against a missing
  // environment. work keeps the hard gate (rebuild → escalate to a human).
  const hostFallbackEligible = role !== 'work';

  const record = spawnStackRebuildState.get(normalizedIssue)
    ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  const fallbackToHost = (reason: string): void => {
    console.warn(`[agents] ${message} — auto-falling back to host for ${role} (${reason})`);
    // Emit the host-fallback notice once per issue. Use a SEPARATE latch from
    // the work-escalation latch (`escalated`): if review/test/ship trip the
    // host fallback first, a later `work` spawn for the same broken-stack issue
    // must still be able to emit its own (error-level) dead-end marker — the
    // operator's only signal that a work agent is blocked on docker.
    if (!record.hostFallbackNoticed) {
      record.hostFallbackNoticed = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'warn',
        issueId: normalizedIssue,
        message: `agent-spawn-host-fallback: ${normalizedIssue}`,
        details: `Workspace docker stack unhealthy (${details}); ${role} runs on the host (rebase/verify use host .git + host gates), so proceeding without containers. ${reason}`,
      });
    }
  };

  const blockWork = (markerMessage: string, errDetails: string): never => {
    if (!record.escalated) {
      record.escalated = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'error',
        issueId: normalizedIssue,
        message: markerMessage,
        details: errDetails,
      });
    }
    throw new Error(message);
  };

  if (record.attempts >= SPAWN_STACK_REBUILD_MAX_ATTEMPTS) {
    if (hostFallbackEligible) {
      fallbackToHost(`rebuild exhausted after ${record.attempts} attempts`);
      return;
    }
    blockWork(
      `agent-spawn-stack-rebuild-exhausted: ${normalizedIssue}`,
      `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${details}. Manual 'pan workspace rebuild ${normalizedIssue}' or retry with --host needed.`,
    );
  }

  if (now - record.lastAttempt < SPAWN_STACK_REBUILD_COOLDOWN_MS) {
    // A rebuild was attempted recently and the stack is still unhealthy —
    // don't hammer `docker compose` every spawn.
    if (hostFallbackEligible) {
      fallbackToHost('rebuild on cooldown');
      return;
    }
    blockWork(`agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`, details);
  }

  record.lastAttempt = now;
  record.attempts += 1;
  spawnStackRebuildState.set(normalizedIssue, record);
  console.log(
    `[agents] Workspace stack for ${normalizedIssue} unhealthy (${details}) — rebuilding ` +
      `before spawn (attempt ${record.attempts}/${SPAWN_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('./workspace/rebuild-stack.js');
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[agents]   ${normalizedIssue} stack rebuild: ${m}`),
    }),
  ).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err) }));

  if (result.success) {
    spawnStackRebuildState.delete(normalizedIssue);
    console.log(`[agents] Workspace stack for ${normalizedIssue} rebuilt — proceeding with spawn`);
    return;
  }

  console.warn(`[agents] Workspace stack rebuild failed for ${normalizedIssue}: ${result.error}`);
  if (hostFallbackEligible) {
    fallbackToHost(`rebuild failed: ${result.error ?? 'unknown'}`);
    return;
  }
  blockWork(`agent-spawn-stack-rebuild-failed: ${normalizedIssue}`, result.error ?? details);
}

export async function spawnRun(issueId: string, role: Role, options: SpawnRunOptions = {}): Promise<AgentState> {
  const workspace = options.workspace ?? defaultRunWorkspace(issueId);
  const modelSpawnKey = `${role}:${issueId}`;
  const selectedModel = determineModel({ model: options.model, role, spawnKey: modelSpawnKey });

  if (role === 'work') {
    return spawnAgent({
      issueId,
      workspace,
      harness: options.harness,
      model: selectedModel,
      prompt: options.prompt,
      role: 'work',
      allowHost: options.allowHost,
      flywheelRunId: options.flywheelRunId,
      effort: options.effort,
    });
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);

  const agentId = options.agentId ?? runAgentId(issueId, role, options.subRole);
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(issueId, role, options.allowHost, workspace);

  initHookSync(agentId);

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness,
    role,
    model: selectedModel,
  });

  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription role runs route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT role run.',
      );
    }
  }

  const state: AgentState = {
    id: agentId,
    issueId,
    workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    hostOverride: options.allowHost || undefined,
  };
  // PAN-1048 P1: spawnRun is on the dashboard hot path (Effect routes,
  // reactive Cloister scheduler). All disk I/O here uses async fs/promises
  // so we never block the Node event loop.
  await Effect.runPromise(saveAgentState(state));

  const isSpecialistRole = role === 'review' || role === 'test' || role === 'ship';
  const shouldRegisterConversation = isSpecialistRole || options.registerConversation === true;
  // PAN-1557: convoy sub-reviewers are now interactive specialists — deliver
  // their prompt via tmux after Claude boots (same as the orchestrator/test/
  // ship), not on stdin to a headless `claude --print`.
  const shouldDeliverPromptViaTmux = shouldRegisterConversation && resolvedHarness === 'claude-code';
  const shouldDeliverPromptViaPi = shouldRegisterConversation && resolvedHarness === 'ohmypi';
  const shouldDeliverPromptViaCodexTui = shouldRegisterConversation && resolvedHarness === 'codex';
  const prompt = options.prompt
    ? await withSpawnTimeMemoryContext({
        prompt: options.prompt,
        issueId,
        workspace,
        agentId,
        role,
        harness: resolvedHarness,
      })
    : '';

  let promptFile: string | undefined;
  if (prompt && !shouldDeliverPromptViaTmux && !shouldDeliverPromptViaPi && !shouldDeliverPromptViaCodexTui) {
    promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
    await writeFileAsync(promptFile, prompt);
  }

  checkAndSetupHooks();

  const provider = getProviderForModelSync(selectedModel as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, workspace);
  } else {
    clearCredentialFileAuthSync(workspace);
  }

  const providerExports = await getProviderExportsForModel(selectedModel);
  const providerEnv = await getProviderEnvForModel(selectedModel);

  // PAN-1048 review feedback 005 (S1): when the resolved harness is ohmypi, thread
  // the per-agent ohmypi launcher fields (--session-dir, --extension, FIFO
  // redirect) through generateLauncherScript so the role launcher emits the
  // correct `omp --mode rpc` command instead of a malformed Claude command.
  // Without this, a config'd `roles.review.harness: ohmypi` produced a launcher
  // that silently fell back to Claude shape.
  const piLauncherFields = resolvedHarness === 'ohmypi'
    ? await getOhmypiLauncherFields(agentId, selectedModel)
    : {};
  const codexLauncherFields = resolvedHarness === 'codex'
    ? getCodexLauncherFields(agentId, selectedModel, workspace)
    : {};

  // Create a conversation record for every specialist role — sub-role reviewers,
  // the review orchestrator/synthesizer, test, and ship. The row is the index
  // the dashboard reads to (a) locate the JSONL via claude_session_id, (b) carry
  // pre-JSONL state (spawn_error, fork_status), and (c) let the
  // conversation-lifecycle service compute sessionAlive from real tmux liveness
  // instead of from the agent state machine's status field, which can lag.
  // Excluding the orchestrator here previously forced AgentOutputPanel to
  // synthesize a Conversation whose sessionAlive came from `agent.status`, and
  // stale snapshots made active synthesizers render as "Starting…".
  let sessionId: string | undefined;
  let rawSessionId: string | undefined;
  if (shouldRegisterConversation) {
    // When resuming, reuse the prior JSONL session so `claude --resume` reloads conversation history.
    // When starting fresh, generate a new UUID and use `claude --session-id`.
    rawSessionId = options.resumeSessionId ?? randomUUID();

    // Persist the session ID to <agentDir>/session.id so resolveClaudeSessionId can locate the
    // JSONL after the specialist exits. Works for both fresh (--session-id) and resumed (--resume).
    try {
      const agentDir = getAgentDir(agentId);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, 'session.id'), rawSessionId, 'utf-8');
    } catch (err) {
      console.warn(`[spawnRun] Failed to persist session.id for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    try {
      const conversation = {
        name: agentId,
        tmuxSession: agentId,
        cwd: workspace,
        issueId,
        claudeSessionId: rawSessionId,
        model: selectedModel,
        harness: resolvedHarness,
      };
      if (getConversationByName(agentId)) {
        reactivateConversationForSpawn(conversation);
      } else {
        createConversation(conversation);
      }
    } catch (err) {
      // Non-fatal: the specialist still runs, but without a conversation record
      console.warn(`[spawnRun] Failed to register conversation for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    // Only set sessionId (→ --session-id flag) for fresh spawns.
    // Resumes pass resumeSessionId (→ --resume flag) to the launcher instead.
    if (!options.resumeSessionId) {
      sessionId = rawSessionId;
    }
  }

  // PAN-1557: convoy reviewers are interactive now, so the launcher no longer
  // owns the REVIEWER_READY/FAILED signal (which previously rode a `claude
  // --print` process exit). The Stop-hook delivers REVIEWER_READY to the
  // synthesis agent when the reviewer finishes its turn with a written report;
  // Deacon's REVIEWER_TIMEOUT remains the failure failsafe. We still persist
  // the synthesis/output wiring on state.json so the Stop-hook can read it.
  if (options.reviewSynthesisAgentId) state.reviewSynthesisAgentId = options.reviewSynthesisAgentId;
  if (options.reviewOutputPath) state.reviewOutputPath = options.reviewOutputPath;

  const launcherContent = generateLauncherScriptSync({
    role,
    workingDir: workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    promptFileMode: undefined,
    overdeckEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    baseCommand: await getRoleRuntimeBaseCommand(selectedModel, agentId, role, resolvedHarness, options.subRole, options.effort),
    appendSystemPromptFiles: await claudeSystemPromptFiles(workspace, resolvedHarness),
    sessionId,
    resumeSessionId: options.resumeSessionId,
    reviewSignal: undefined,
    trapHup: undefined,
    ...piLauncherFields,
    ...codexLauncherFields,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(workspace);
  } catch { /* non-fatal */ }

  // PAN-1594: clear any stale ready.json before launch so waitForReadySignal()
  // only observes the session-start signal from THIS launch.
  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: issueId,
      OVERDECK_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      ...flywheelEnv,
      ...providerEnv,
    },
  }));
  if (shouldRegisterConversation) {
    await saveAgentRuntimeState(agentId, {
      claudeSessionId: rawSessionId,
      ...(options.resumeSessionId ? {} : {
        sessionModel: selectedModel,
        sessionHarness: resolvedHarness,
      }),
    });
  }
  await Effect.runPromise(setOption(agentId, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(exactPaneTarget(agentId), 'remain-on-exit', 'on'));

  if (prompt) {
    if (shouldDeliverPromptViaPi) {
      try {
        await writeOhmypiAgentPrompt(agentId, prompt);
      } catch (err) {
        console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      }
    } else if (shouldDeliverPromptViaTmux || shouldDeliverPromptViaCodexTui) {
      // PAN-1594: wait for the hook-written ready.json (session-start hook),
      // not a tmux pane-scrape. No dependency on permission-mode footer text.
      const ready = await waitForPromptReady(agentId, resolvedHarness, 30);
      if (ready) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt');
      } else {
        console.error(`[${agentId}] ${resolvedHarness === 'codex' ? 'Codex' : 'Claude'} did not become ready within 30s`);
      }
    }
  }

  markAgentRunning(state);

  // Stamp the workspace HEAD this role run was launched against. The reactive
  // scheduler uses this to tell a still-relevant run from a zombie session
  // left behind by an agent that finished work but never exited (the ship/test
  // stall class of bug). A non-fatal git probe — if it fails the marker is
  // simply absent and activeRoleRunExists falls back to status-only checks.
  try {
    const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspace });
    const head = stdout.trim();
    if (head) state.roleRunHead = head;
  } catch { /* non-fatal — marker stays absent */ }

  await Effect.runPromise(saveAgentState(state));

  // PAN-1556: the review role emits a single dedicated "Review role spawned"
  // event from spawnReviewRoleForIssue. Suppress the generic per-spawn
  // "role started" for review so the orchestrator + 4 convoy sub-reviewers
  // don't each spam the session feed and bury conversations.
  if (role !== 'review') {
    emitActivityEntrySync({
      source: role,
      level: 'info',
      message: `${role} role started for ${issueId}`,
      issueId,
    });
  }

  return state;
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const role: 'work' | 'strike' = options.role ?? 'work';
  const sessionPrefix = role === 'strike' ? 'strike' : 'agent';
  // PAN-1517: slot-suffixed agent ids removed alongside the swarm runtime;
  // there is one work agent per issue, period.
  const agentId = `${sessionPrefix}-${options.issueId.toLowerCase()}`;

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHookSync(agentId);

  // Strike agents bypass the normal pipeline (no plan/beads/review/test) —
  // see roles/strike.md. The beads gate is the only thing we skip; everything
  // else (workspace health, supervisor wiring, launcher) is identical.
  if (role !== 'strike') {
    // Use a short lock timeout when spawning from HTTP handlers so dashboard
    // requests fail fast to the JSONL fallback instead of blocking behind CLI
    // processes that hold the cross-process bd lock. The CLI `pan start` path
    // already performs a long-timeout live query before reaching spawnAgent.
    try {
      await Effect.runPromise(
        assertIssueHasBeads(options.workspace, options.issueId, { acquisitionTimeoutMs: 500 }),
      );
    } catch (error) {
      if (error instanceof BeadsMissingError && error.transientFailure !== undefined) {
        const attempts = error.transientFailure instanceof BdTransientFailure
          ? ` after ${error.transientFailure.attempts} attempts`
          : '';
        throw new Error(
          `Beads database was temporarily locked while checking ${options.issueId}${attempts}; re-run shortly.`
        );
      }
      throw error;
    }
  }

  // Determine model based on role configuration
  const modelSpawnKey = `${role}:${options.issueId}`;
  const selectedModel = determineModel({ model: options.model, role, spawnKey: modelSpawnKey });
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription agents route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT agent.',
      );
    }
  }

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness,
    role,
    model: selectedModel,
  });

  // Create state
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    hostOverride: options.allowHost || undefined,
  };

  const supervisorLaunch = await prepareSupervisorForFreshLaunch(agentId, options, state);

  saveAgentStateSync(state);

  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (role === 'work') {
    try {
      const resetStatus = resetPipelineVerdictsForWorkStartSync(options.issueId);
      if (resetStatus) {
        const { resetPostMergeState } = await import('./cloister/merge-agent.js');
        resetPostMergeState(options.issueId);
      }
    } catch (err) {
      console.warn(`[agents] Could not reset stale pipeline verdicts for ${options.issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For child stories: synthesize feature context from parent feature plan
  // before the agent starts so readFeatureContext has O(1) local access.
  if (role === 'work') {
    try {
      const { writeStoryFeatureContext } = await import('./cloister/work-agent-prompt.js');
      await writeStoryFeatureContext(options.workspace, options.issueId);
    } catch (ctxErr: any) {
      console.warn(`[agents] Could not write story feature context for ${options.issueId}: ${ctxErr.message}`);
    }
  }

  // PAN-1215: One-shot cleanup of tracked workspace-only .pan/ artifacts.
  // These files are gitignored but may still be tracked on older branches.
  // If tracked, checkpoint commits and rebases can drop them, breaking the
  // verification gate. Remove them from the index when the workspace is clean.
  if (role === 'work') {
    try {
      const workspace = options.workspace;
      const { stdout: trackedFiles } = await execAsync(
        'git ls-files .pan/continue.json .pan/spec.vbrief.json',
        { cwd: workspace },
      );
      if (trackedFiles.trim()) {
        const { stdout: porcelain } = await execAsync(
          'git status --porcelain -- .pan/',
          { cwd: workspace },
        );
        if (!porcelain.trim()) {
          await execAsync(
            'git rm --cached --ignore-unmatch .pan/continue.json .pan/spec.vbrief.json',
            { cwd: workspace },
          );
          await execAsync(
            'git commit -m "chore: untrack workspace .pan/ artifacts (PAN-1215)"',
            { cwd: workspace },
          );
          console.log(`[agents] Untracked workspace .pan/ artifacts for ${options.issueId}`);
        } else {
          console.warn(`[agents] Skipping .pan/ untrack for ${options.issueId} — .pan/ paths have uncommitted changes`);
        }
      }
    } catch (err: any) {
      console.warn(`[agents] .pan/ untrack cleanup failed for ${options.issueId}: ${err.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHookSync(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  if (prompt) {
    prompt = await withSpawnTimeMemoryContext({
      prompt,
      issueId: options.issueId,
      workspace: options.workspace,
      agentId,
      role,
      harness: resolvedHarness,
    });
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  const tracksKickoffDelivery = role === 'work' || role === 'strike';
  if (prompt) {
    await writeFileAsync(promptFile, prompt);
    if (tracksKickoffDelivery) {
      state.kickoffDelivered = false;
      saveAgentStateSync(state);
    }
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal).
  // Gated by the operator TLDR toggle: when disabled, the daemon is not started
  // and the agent (whose prompt reports TLDR_AVAILABLE=false) degrades to direct
  // file reads.
  try {
    const venvPath = join(options.workspace, '.venv');
    if (isTldrEnabledSync() && existsSync(venvPath)) {
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(options.workspace, venvPath);
      const status = await tldrService.getStatus();
      if (!status.running) {
        await tldrService.start(true);
        console.log(`[${agentId}] Started TLDR daemon for workspace`);
      }
    }
  } catch {
    // Non-fatal — agents degrade to direct file reads if TLDR unavailable
  }

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Clear ready signal before spawning (clean slate for PAN-87 fix)
  clearReadySignal(agentId);

  // Channels MCP gate: only the explicit legacy override writes a per-agent
  // .mcp.json, bridge token, and channelsEnabled state for new spawns. The PTY
  // supervisor remains the default delivery transport.
  const channelsDecision = decideChannelsForWorkAgent(agentId, options, state);
  let channelsBridgeMcpConfig: string | undefined;
  if (channelsDecision.eligible) {
    channelsBridgeMcpConfig = join(options.workspace, '.pan', 'agent-mcp.json');
    writeBridgeTokenSync(agentId);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, agentId);
    state.channelsEnabled = true;
    saveAgentStateSync(state);
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);
  const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
    agentId,
    model: selectedModel,
    workspace: options.workspace,
    role,
    isPlanning: false,
    channelsBridgeMcpConfig,
    useSupervisor: supervisorLaunch.useSupervisor,
    supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    harness: state.harness ?? 'claude-code',
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    effort: options.effort,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=work-agent | model=${state.model} | source=agents.ts:spawnAgent | session=${agentId} | command="${claudeCmd}"`);

  // Pre-trust workspace directory in Claude Code to avoid the trust prompt
  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(options.workspace);
  } catch { /* non-fatal */ }

  // Configure workspace for GitHub App bot identity (PAN-536)
  // Agents push as panopticon-agent[bot] with short-lived installation tokens
  try {
    const { isGitHubAppConfigured, generateInstallationToken, configureWorkspaceForBot } = await import('./github-app.js');
    if (isGitHubAppConfigured()) {
      const { findProjectByPathSync } = await import('./projects.js');
      const project = findProjectByPathSync(resolve(options.workspace, '..', '..'));
      const ghRepo = project?.github_repo;
      if (ghRepo) {
        const [owner, repo] = ghRepo.split('/');
        const { token } = await Effect.runPromise(generateInstallationToken());
        await configureWorkspaceForBot(options.workspace, owner, repo, token);
        console.log(`[${agentId}] Configured workspace for bot push (panopticon-agent[bot])`);
      }
    }
  } catch (err: any) {
    console.warn(`[${agentId}] GitHub App config failed (falling back to SSH): ${err.message}`);
  }

  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, options.workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV, // Blank stale provider vars inherited by tmux server
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: options.issueId,
      OVERDECK_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...flywheelEnv,
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    }
  }));
  await saveAgentRuntimeState(agentId, {
    sessionModel: selectedModel,
    sessionHarness: resolvedHarness,
  });

  // Channels: start dismissing the dev-channels confirmation dialog as soon as
  // the tmux session exists, but only block on completion when we are about to
  // deliver an initial prompt. Spawn-only callers should not sit in a 20s poll
  // loop waiting for a dialog they may never need.
  const dismissChannelsDialogPromise = channelsBridgeMcpConfig
    ? dismissDevChannelsDialog(agentId).catch(() => undefined)
    : null;

  // Send the initial prompt after the interactive prompt is ready.
  if (prompt && resolvedHarness === 'ohmypi') {
    try {
      await writeOhmypiAgentPrompt(agentId, prompt);
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } catch (err) {
      console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      if (tracksKickoffDelivery) {
        await recordKickoffDeliveryFailure(state, options.issueId, role);
        if (role === 'strike') {
          await Effect.runPromise(stopAgent(agentId));
          throw new Error(`Agent ${agentId} kickoff delivery failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return state;
      }
    }
  } else if (prompt) {
    if (dismissChannelsDialogPromise) {
      await dismissChannelsDialogPromise;
    }
    const delivery = await deliverInitialPromptWithRetry(agentId, prompt, 'spawnAgent:initial-prompt', state.deliveryMethod);
    if (delivery.ok) {
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } else if (tracksKickoffDelivery) {
      if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
        await recordStartupSessionExit(state, options.issueId, role);
      }
      await recordKickoffDeliveryFailure(state, options.issueId, role);
      if (role === 'strike') {
        await Effect.runPromise(stopAgent(agentId));
        throw new Error(`Agent ${agentId} kickoff delivery failed: ${delivery.failure ?? 'unknown error'}`);
      }
      return state;
    }
  }

  // For codex work agents, poll for the first rollout JSONL in the background
  // and persist the thread-id so transcript/cost lookups hit the fast path
  // (PAN-1805). Non-blocking — codex writes its rollout only after the kickoff
  // prompt lands, so a blocking wait here would stall spawn. The latest-rollout
  // fallback covers sessions whose first turn lands after this window.
  if (resolvedHarness === 'codex') {
    const codexHomeForAgent = join(homedir(), '.overdeck', 'agents', agentId, 'codex-home');
    void (async () => {
      try {
        const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId } =
          await import('./runtimes/codex.js');
        const rollout = await waitForCodexRollout(codexHomeForAgent, 120_000);
        if (rollout) {
          const threadId = extractThreadIdFromRollout(rollout);
          if (threadId) writeThreadId(agentId, threadId);
        }
      } catch { /* non-fatal — the latest-rollout fallback still resolves the transcript */ }
    })();
  }

  // Update status
  markAgentRunning(state);
  saveAgentStateSync(state);

  // Track work in CV
  startWorkSync(agentId, options.issueId);

  // Emit activity + TTS so the user knows an agent has started
  emitActivityEntrySync({
    source: role,
    level: 'info',
    message: `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTtsSync({
    utterance: `Work agent started for ${options.issueId}`,
    priority: 2,
    issueId: options.issueId,
    source: 'work-agent',
    eventType: 'workAgent.started',
  });

  return state;
}

export { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync };
export { stopAgentSync, stopAgent } from './agents/termination.js';


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
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('./remote/remote-agents.js');
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
        import('../dashboard/server/services/conversation-compaction.js'),
        import('./conversations/smart-compaction.js'),
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
        const { generateFallbackSummary } = await import('./conversations/summary-fork.js');
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
  const piProcessWasAlive = agentState.harness === 'ohmypi'
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
        const { getReviewStatusSync } = await import('./review-status.js');
        const rs = getReviewStatusSync(agentState.issueId);
        if (rs?.stuck && rs.stuckReason === 'context_overflow') {
          const { clearWorkspaceStuck } = await import('./review-status.js');
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

export interface RestartAgentOptions {
  model?: string;
  harness?: RuntimeName;
  graceful?: boolean;
  message?: string;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message } = opts;
  const newModel = normalizeModelOverrideSync(rawNewModel);

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  const gateBlockReason = getAgentResumeGateBlockReason(agentState);
  if (gateBlockReason) {
    const reason = `Cannot restart ${normalizedId}: ${gateBlockReason}. Clear the gate before restarting.`;
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logAgentLifecycleSync(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'}, harness=${newHarness || 'unchanged'})`);

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  if (graceful && await Effect.runPromise(sessionExists(normalizedId))) {
    await sendGracefulRestartWarning(normalizedId, agentState.harness, agentState.workspace);
  }

  await Effect.runPromise(stopAgent(normalizedId));

  const effectiveModel = newModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
  const effectiveHarness = await resolveHarness({
    explicit: newHarness ?? agentState.harness,
    role: agentState.role,
    model: effectiveModel,
  });
  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.harness = effectiveHarness;
  agentState.status = 'starting';
  saveAgentStateSync(agentState);

  try {
    clearReadySignal(normalizedId);
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, effectiveModel, effectiveHarness);
    saveAgentStateSync(agentState);

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: effectiveModel,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
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
        TERM: 'xterm-256color',
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        GIT_SEQUENCE_EDITOR: 'false',
        ...providerEnv,
      },
    }));

    const prompt = message || `You are resuming work on ${agentState.issueId}. Read .pan/continue.json for context and pick up where you left off.`;
    if (effectiveHarness === 'ohmypi') {
      // ohmypi does not fire the Claude SessionStart hook and does not read tmux
      // input — wait for ready.json and write the continue prompt through the
      // FIFO JSONL protocol.
      try {
        await writeOhmypiAgentPrompt(normalizedId, prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restartAgent] ohmypi prompt delivery failed for ${normalizedId}: ${msg}`);
      }
    } else {
      const ready = await waitForPromptReady(normalizedId, effectiveHarness, 30);
      if (ready) {
        await new Promise(r => setTimeout(r, 500));
        if (effectiveHarness === 'codex') {
          await deliverAgentMessage(normalizedId, prompt, 'restartAgent:continue-prompt', resilientDeliveryMethod(agentState.deliveryMethod));
        } else {
          await Effect.runPromise(sendKeys(normalizedId, prompt));
        }
      } else {
        console.error(`[restartAgent] ${effectiveHarness === 'codex' ? 'Codex' : 'Claude'} did not become ready within 30s for ${normalizedId}`);
      }
    }

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });

    logAgentLifecycleSync(normalizedId, `restartAgent SUCCESS: model=${effectiveModel}`);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent FAILED: ${msg}`);
    return { success: false, error: `Failed to restart agent: ${msg}` };
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

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgentsSync();
  return agents.filter(
    (agent) => agent.status === 'running' && !agent.tmuxActive
  );
}

/**
 * Recover a crashed agent by restarting it with context
 */
export async function recoverAgent(
  agentId: string,
  opts: { modelOverride?: string } = {},
): Promise<AgentState | null> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycleSync(normalizedId, 'recoverAgent called');
  const state = getAgentStateSync(normalizedId);

  if (!state) {
    logAgentLifecycleSync(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const gateBlockReason = getAgentResumeGateBlockReason(state);
  if (gateBlockReason) {
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: Cannot recover ${normalizedId}: ${gateBlockReason}. Clear the gate before recovering.`);
    return null;
  }
  const modelOverride = normalizeModelOverrideSync(opts.modelOverride);
  if (modelOverride) {
    state.model = modelOverride;
    logAgentLifecycleSync(normalizedId, `recoverAgent: model overridden → ${modelOverride}`);
  }
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  const recoveryRole: Role = state.role
    ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work');
  try {
    await assertWorkspaceStackHealthyForSpawn(
      state.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      recoveryRole,
      state.hostOverride === true,
      state.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  // Check if already running — session may exist with only a bare shell
  // after Claude exited (zombie session). Kill it and recover.
  if (sessionExistsSync(normalizedId)) {
    const recoveryHarness: RuntimeName = normalizeHarness(state.harness ?? null) ?? 'claude-code';
    if (await hasAgentRuntimeInSession(normalizedId, recoveryHarness)) {
      return state;
    }
    console.log(`[agents] ${normalizedId} tmux session is a zombie (no ${recoveryHarness} runtime) — killing and recovering`);
    try { killSessionSync(normalizedId); } catch { /* ignore */ }
  }

  // Update crash count in health file
  const healthFile = join(getAgentDir(normalizedId), 'health.json');
  let health = { consecutiveFailures: 0, killCount: 0, recoveryCount: 0 };
  if (existsSync(healthFile)) {
    try {
      health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
    } catch {}
  }
  health.recoveryCount = (health.recoveryCount || 0) + 1;
  writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Build recovery prompt
  const recoveryPrompt = generateRecoveryPrompt(state);

  // Get provider env for the agent's model (reads latest API key from settings)
  const providerEnv = state.model ? await getProviderEnvForModel(state.model) : {};

  // For credential-file providers, ensure apiKeyHelper is configured.
  // For all other providers, clear stale apiKeyHelper from previous runs.
  if (state.model) {
    const provider = getProviderForModelSync(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuthSync(provider, state.workspace);
    } else {
      clearCredentialFileAuthSync(state.workspace);
    }
  }

  // Restart the agent with recovery context. PAN-1048 C4: derive the role from
  // the saved AgentState (or the session-id heuristic for legacy planning-* IDs)
  // and route through getRoleRuntimeBaseCommand so review/test/ship don't get
  // resurrected as work agents.
  const recoveryHarness: RuntimeName = normalizeHarness(state.harness ?? null) ?? 'claude-code';
  const recoverySupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, state, state.model, recoveryHarness);
  saveAgentStateSync(state);

  if (recoveryHarness === 'ohmypi') {
    // PAN-1055: ohmypi cannot consume the recovery prompt as a positional shell
    // argument the way the Claude direct command path does — ohmypi reads JSONL
    // commands from its FIFO. Build a real ohmypi launcher (extension path,
    // --session-dir, FIFO redirect) via buildAgentLaunchConfig, then deliver
    // the recovery prompt through the FIFO once omp reports ready.
    const { launcherContent, providerEnv: piProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      harness: 'ohmypi',
    });
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    await Effect.runPromise(createSession(normalizedId, state.workspace, `bash ${launcherScript}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: state.issueId || '',
        OVERDECK_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...piProviderEnv,
      },
    }));
    try {
      await writeOhmypiAgentPrompt(normalizedId, recoveryPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recoverAgent] ohmypi recovery prompt delivery failed for ${normalizedId}: ${msg}`);
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (ohmypi)`);
    return state;
  }

  const recoveryCodexFields = recoveryHarness === 'codex'
    ? getCodexLauncherFields(normalizedId, state.model, state.workspace)
    : {};
  const recoveryLauncherContent = generateLauncherScriptSync({
    role: recoveryRole,
    workingDir: state.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports: (await getProviderExportsForModel(state.model)).trimEnd(),
    baseCommand: await getRoleRuntimeBaseCommand(state.model, normalizedId, recoveryRole, recoveryHarness),
    appendSystemPromptFiles: await claudeSystemPromptFiles(state.workspace, recoveryHarness),
    ...(recoveryHarness === 'codex' ? {} : { promptInline: recoveryPrompt }),
    useSupervisor: recoverySupervisorLaunch.useSupervisor,
    supervisorScriptPath: recoverySupervisorLaunch.supervisorScriptPath,
    ...recoveryCodexFields,
  });
  const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, recoveryLauncherContent);
  createSessionSync(normalizedId, state.workspace, `bash ${launcherScript}`, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      OVERDECK_AGENT_ID: normalizedId,
      OVERDECK_ISSUE_ID: state.issueId || '',
      OVERDECK_SESSION_TYPE: state.role ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work'),
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    }
  });

  saveAgentStateSync(state);
  if (recoveryHarness === 'codex') {
    const delivery = await deliverInitialPromptWithRetry(normalizedId, recoveryPrompt, 'recoverAgent:recovery-prompt', state.deliveryMethod);
    if (!delivery.ok) {
      console.error(`[recoverAgent] Codex recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`);
    }
  }
  // Update state
  markAgentRunning(state);
  saveAgentStateSync(state);

  logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount}`);
  return state;
}

/**
 * Generate a recovery prompt for a crashed agent
 */
function generateRecoveryPrompt(state: AgentState): string {
  const lines: string[] = [
    '# Agent Recovery',
    '',
    '⚠️ This agent session was recovered after a crash.',
    '',
    '## Previous Context',
    `- Issue: ${state.issueId}`,
    `- Workspace: ${state.workspace}`,
    `- Started: ${state.startedAt}`,
    '',
    '## Recovery Steps',
    '1. Check beads for context: `bd show ' + state.issueId + '`',
    '2. Review recent git commits: `git log --oneline -10`',
    '3. Check hook for pending work: `pan admin fpp check`',
    '4. Resume from last known state',
    '',
    '## FPP Reminder',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  // Add FPP work if available
  const { hasWork } = checkHookSync(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(state.id);
    if (fixedPointPrompt) {
      lines.push('---');
      lines.push('');
      lines.push(fixedPointPrompt);
    }
  }

  return lines.join('\n');
}

/**
 * Auto-recover all crashed agents
 */
export async function autoRecoverAgents(): Promise<{ recovered: string[]; failed: string[] }> {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = await recoverAgent(agent.id);
      if (result) {
        recovered.push(agent.id);
      } else {
        failed.push(agent.id);
      }
    } catch (error) {
      failed.push(agent.id);
    }
  }

  return { recovered, failed };
}

/**
 * Check if Overdeck hooks are configured, and auto-setup if not
 */
function checkAndSetupHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const hookPath = join(homedir(), '.overdeck', 'bin', 'heartbeat-hook');

  // Check if settings.json exists and has heartbeat hook configured
  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const postToolUse = settings?.hooks?.PostToolUse || [];

      const hookConfigured = postToolUse.some((hookConfig: any) =>
        hookConfig.hooks?.some((hook: any) =>
          hook.command === hookPath ||
          hook.command?.includes('overdeck') ||
          hook.command?.includes('heartbeat-hook')
        )
      );

      if (hookConfigured) {
        return; // Already configured
      }
    } catch {
      // Ignore errors, will attempt setup
    }
  }

  // Hooks not configured - run setup silently
  try {
    console.log('Configuring Overdeck heartbeat hooks...');
    // Note: This runs during spawn which is now async, so we can use execAsync
    // But this is called from a sync context in checkAndSetupHooks, so we use fire-and-forget
    exec('pan admin hooks install', (error: Error | null) => {
      if (error) {
        console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
      } else {
        console.log('✓ Heartbeat hooks configured');
      }
    });
  } catch (error) {
    console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
  }
}

/**
 * Write task cache for heartbeat hook to use
 */
function writeTaskCache(agentId: string, issueId: string): void {
  const cacheDir = join(getAgentDir(agentId));
  mkdirSync(cacheDir, { recursive: true });

  const cacheFile = join(cacheDir, 'current-task.json');
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: issueId,
      title: `Working on ${issueId}`,
      updated_at: new Date().toISOString()
    }, null, 2)
  );
}
