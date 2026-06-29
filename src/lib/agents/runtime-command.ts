import { existsSync, mkdirSync, readFileSync, statfsSync, statSync, writeFileSync } from 'fs';
import { mkdir, rename as renameAsync, stat as statAsync, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { parse as parseYaml } from 'yaml';
import { Effect } from 'effect';
import type { MemoryIdentity } from '@overdeck/contracts';
import { getClaudePermissionFlagsStringSync } from '../claude-permissions.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import type { RoleEffort } from '../config-yaml.js';
import { ensureSessionContextBriefingFile } from '../briefing-freshness.js';
import { getClaudeAuthStatus } from '../claude-auth.js';
import { workspaceContextFile } from '../context-layers/layers.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { initCodexHome } from '../runtimes/codex.js';
import { createOhmypiFifo, ohmypiFifoPaths, OhmypiNotReady, writeOhmypiCommandSync } from '../runtimes/ohmypi-fifo.js';
import { createPiFifo, piFifoPaths, PiNotReady, writePiCommandSync } from '../runtimes/pi-fifo.js';
import type { RuntimeName } from '../runtimes/types.js';
import { requireModelOverrideSync, shellQuoteModelIdSync } from '../model-validation.js';
import { getOpenAIAuthStatus } from '../openai-auth.js';
import { getOverdeckHome, packageRoot, resolveOhmypiExtensionPath, resolvePiExtensionPath } from '../paths.js';
import { getProviderForModelSync } from '../providers.js';
import type { AuthMode } from '../subscription-types.js';
import { capturePane, sessionExists } from '../tmux.js';
import { getAgentDir, getAgentStateSync, type Role } from './agent-state.js';
import { CLI_PROXY_MODEL_ALIASES } from './provider-env.js';

const execAsync = promisify(exec);
const missingRoleDefinitionWarnings = new Set<string>();

/**
 * Write an agent launcher script atomically. Every agent shares a fixed
 * `launcher.sh` path inside its agent dir, and spawn/resume/restart paths can
 * overlap (e.g. a Deacon recovery racing a manual restart). Writing in place
 * lets one path read a half-written script; write to a unique temp file then
 * rename (atomic on the same filesystem).
 */
export async function writeLauncherScriptAtomic(launcherScript: string, content: string): Promise<void> {
  const tmp = `${launcherScript}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { mode: 0o755 });
  await renameAsync(tmp, launcherScript);
}

export async function claudeSystemPromptFiles(workspace: string, harness: RuntimeName | undefined): Promise<string[]> {
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
  const behavior = getHarnessBehavior(harness);
  if (behavior.contextLayerKind === 'pi') {
    const { piGlobalContextFile } = await import('../context-layers/index.js');
    const globalFile = piGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  // PAN-1574: Codex receives its rendered global context layer (codex-global.md).
  if (behavior.contextLayerKind === 'codex') {
    const { codexGlobalContextFile } = await import('../context-layers/index.js');
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
export async function hasAgentRuntimeInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<boolean> {
  const expectedProcessNames = new Set(getHarnessBehavior(harness).processNames);
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

export async function getPiLauncherFields(agentId: string, model: string): Promise<{
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

export async function getOhmypiLauncherFields(agentId: string, model: string): Promise<{
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

export function getCodexLauncherFields(agentId: string, model: string, workspacePath?: string): {
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

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getAgentDir(agentId), 'ready.json');
}

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

export async function waitForPromptReady(agentId: string, harness: RuntimeName | undefined, timeoutSec = 30): Promise<boolean> {
  if (getHarnessBehavior(harness).readinessKind === 'codex-tui-prompt') return waitForCodexTuiReady(agentId, timeoutSec);
  return waitForReadySignal(agentId, timeoutSec);
}

export function inferMemoryProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return workspaceName;
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
    const { injectPromptTimeMemory } = await import('../memory/injection.js');
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
    const { injectPromptTimeMemory } = await import('../memory/injection.js');
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
export async function writePiAgentPrompt(agentId: string, prompt: string, timeoutSec = 30): Promise<void> {
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

export async function writeOhmypiAgentPrompt(agentId: string, prompt: string, timeoutSec = OHMYPI_AGENT_READY_TIMEOUT_SECONDS): Promise<void> {
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

/**
 * Build the base command that the launcher will exec for an agent.
 *
 * The `harness` parameter (PAN-636) selects between Claude Code (default)
 * and ohmypi/Pi. When the harness uses the ohmypi RPC command, the function
 * short-circuits to a
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
  const behavior = getHarnessBehavior(harness);
  if (behavior.launchCommandKind === 'ohmypi-rpc') {
    return `omp --mode rpc --model ${quotedModel}`;
  }
  if (behavior.launchCommandKind === 'codex-work-tui') {
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
export function roleSystemPromptInjectionSync(definitionPath: string, explicitEffort?: RoleEffort): string {
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
  const behavior = getHarnessBehavior(harness);
  if (behavior.launchCommandKind === 'ohmypi-rpc') {
    return `omp --mode rpc --model ${quotedModel}`;
  }
  if (behavior.launchCommandKind === 'codex-work-tui') {
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
