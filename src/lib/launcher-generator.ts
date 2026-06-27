import { Effect } from 'effect';
import { dirname, join } from 'node:path';
import type { Role } from './agents.js';
import { toCodexSandboxValue } from './runtimes/codex.js';
import { qualifyPiModel } from './providers.js';
import { shellQuoteModelIdSync } from './model-validation.js';
import { colorFgBgForTheme, getUiThemeSync } from './ui-theme.js';

export type LauncherSpawnMode = 'conversation' | 'remote' | 'resume';

export type LauncherHarness = 'claude-code' | 'ohmypi' | 'codex';

export interface LauncherConfig {
  role: Role;
  spawnMode?: LauncherSpawnMode;
  workingDir: string;

  /**
   * Which coding-agent harness this launcher targets. Defaults to
   * 'claude-code' when omitted so existing call sites stay bit-for-bit
   * unchanged. When 'pi', the generator emits a Pi command line and
   * redirects stdin from piFifoPath instead of leaving stdin attached
   * to the tmux pane.
   */
  harness?: LauncherHarness;
  /**
   * Pi output mode (mapped to `pi --mode <mode>`).
   *
   *   - 'rpc' (default for harness='pi'): JSONL command stream over stdin/
   *     stdout. Used for work-agents where Cloister needs structured delivery.
   *     Requires piFifoPath. Pane is non-interactive (no TUI).
   *   - 'tui': interactive Pi terminal UI (Pi's default mode). Used for
   *     conversation panels so users can type in the tmux pane directly.
   *     Dashboard messages are delivered via tmux paste-buffer instead of
   *     the FIFO. piFifoPath is not used in this mode.
   *
   * Pi writes JSONL session files via --session-dir regardless of mode, so
   * cost parsing keeps working in both modes.
   */
  piMode?: 'rpc' | 'tui';
  /** Absolute path to packages/pi-extension/dist/index.js. Required for harness='pi'. */
  piExtensionPath?: string;
  /** Absolute path to ~/.overdeck/agents/<id>/rpc.in. Required for harness='pi' + piMode='rpc'. */
  piFifoPath?: string;
  /** Absolute path to per-agent Pi session-dir (Pi --session-dir). Required for harness='pi'. */
  piSessionDir?: string;

  /**
   * Codex agent mode. Defaults to 'exec' (headless legacy mode).
   *   - 'exec': non-interactive `codex exec` with approval_policy=never
   *   - 'tui': bare `codex` interactive TUI (conversation panels)
   *   - 'work-tui': interactive work-agent TUI with sandbox/approval flags
   */
  codexMode?: 'exec' | 'tui' | 'work-tui';
  /**
   * Per-agent CODEX_HOME directory path (e.g. ~/.overdeck/agents/<id>/codex-home).
   * When set, exported as CODEX_HOME before launching codex.
   */
  codexHome?: string;
  /**
   * Absolute path to the per-agent codex session directory.
   * (Informational — codex writes rollout JSONL here; not passed as a flag.)
   */
  codexSessionDir?: string;
  /**
   * Sandbox mode for `codex exec -s <mode>`. Defaults to 'workspace' (allows
   * reading and writing files in the working directory).
   */
  codexSandboxMode?: string;

  // Command construction
  /**
   * Base command to run (e.g. 'claude', 'claude --model gpt-5.4').
   * For conversation agents this must be a single unquoted token;
   * the generator does NOT tokenize shell-quoted arguments.
   */
  baseCommand?: string;
  promptFile?: string;
  promptFileMode?: 'argument' | 'stdin';
  promptInline?: string;

  /**
   * PAN-1201: absolute path to the workspace's assembled context bundle
   * (`<workspace>/.pan/context/workspace.md`). When set on a Claude Code
   * launcher the generator appends `--append-system-prompt-file <path>` so
   * the agent's system prompt carries the layered workspace context. Ignored
   * for Pi launchers — the Pi extension loads workspace.md at session_start.
   */
  appendSystemPromptFile?: string;
  appendSystemPromptFiles?: string[];

  /**
   * Review sub-role launcher contract (PAN-977). When set, the launcher does
   * NOT `exec` claude — it runs `timeout <N> claude --print ... < prompt` as a
   * child process, then deterministically signals the synthesis agent based on
   * the outcome:
   *   - exit 124            → REVIEWER_TIMEOUT  (timeout killed the reviewer)
   *   - report file present → REVIEWER_READY
   *   - otherwise           → REVIEWER_FAILED   (crashed/exited with no report)
   * After signaling it touches `signalMarkerPath` so Deacon's convoy watchdog
   * knows the launcher already owned the signal and stays a rare backup rather
   * than the happy path. This makes the happy path self-contained in the
   * launcher's own bash process — it only fails to signal if SIGKILLed.
   */
  reviewSignal?: {
    synthesisAgentId: string;
    subRole: string;
    outputPath: string;
    signalMarkerPath: string;
    /**
     * Absolute path the launcher writes its own bash pid into at startup and
     * removes once it has signaled. Deacon's convoy watchdog checks this pid
     * for liveness instead of the (intentionally short-lived) tmux session.
     */
    launcherPidPath: string;
    timeoutSeconds: number;
  };

  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  permissionFlags?: string[];
  extraArgs?: string;

  // Env shaping
  setTerminalEnv?: boolean;
  providerExports?: string;
  unsetProviderEnv?: boolean;
  cavemanExports?: string;
  overdeckEnv?: { agentId?: string; issueId?: string; sessionType?: string };
  unsetOverdeckEnv?: boolean;
  extraEnvExports?: string[];

  // Shell hygiene
  setPipefail?: boolean;
  trapHup?: boolean;
  changeDir?: boolean; // default true; set false for work/resume agents that rely on tmux -c

  // Post-claude behavior
  keepAlive?: boolean;
  debugLog?: string;
  useScriptWrapper?: boolean;
  scriptLogFile?: string;
  innerScriptPath?: string;

  // Remote
  setRemotePath?: boolean;
  escapeForBase64?: boolean;

  // File permissions for the generated script (default: 0o755)
  fileMode?: number;

  /**
   * Absolute path to a per-agent .mcp.json that wires the overdeck-bridge
   * (and any other custom MCP servers) into the claude invocation. When set
   * together with channelsBridgeServerName, the launcher appends
   *   --mcp-config <path> --dangerously-load-development-channels server:<name>
   * to the claude command before --session-id and --model.
   *
   * --mcp-config is additive — project-level .mcp.json continues to load —
   * so we MUST NOT also pass --strict-mcp-config.
   *
   * When undefined, the generated script is byte-for-byte identical to the
   * pre-PAN-985 behaviour (channels off path).
   */
  channelsBridgeMcpConfig?: string;

  /**
   * Server name from the per-agent .mcp.json that should be loaded as a
   * Claude Code Channel. Defaults to 'overdeck-bridge' when
   * channelsBridgeMcpConfig is set; ignored when the MCP config path is
   * not also provided.
   */
  channelsBridgeServerName?: string;

  /** Wrap Claude Code in the PTY supervisor: `node <supervisorScriptPath> claude ...`. Defaults to false. */
  useSupervisor?: boolean;
  /** Absolute path to dist/pty-supervisor.js. Required when useSupervisor=true. */
  supervisorScriptPath?: string;
}

/**
 * Quote a string for safe use as a shell literal in single quotes.
 * e.g. shellQuote("foo'bar") → "'foo'\\''bar'"
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the trailing `--mcp-config <path> --dangerously-load-development-channels server:<name>`
 * fragment when both channels-bridge fields are set. Returns an empty string when
 * channelsBridgeMcpConfig is unset so existing call sites stay byte-identical.
 *
 * Note: --mcp-config is intentionally additive (no --strict-mcp-config) so the
 * project's .mcp.json continues to load alongside the bridge.
 */
function buildChannelsArgs(config: LauncherConfig): string {
  if (!config.channelsBridgeMcpConfig) return '';
  const serverName = config.channelsBridgeServerName ?? 'overdeck-bridge';
  return ` --mcp-config ${shellQuote(config.channelsBridgeMcpConfig)} --dangerously-load-development-channels server:${serverName}`;
}

function wrapWithSupervisor(config: LauncherConfig, cmd: string): string {
  if (!config.useSupervisor) return cmd;
  if (config.harness === 'ohmypi' || config.reviewSignal) return cmd;
  if (!config.supervisorScriptPath) {
    throw new Error('LauncherConfig.supervisorScriptPath is required when useSupervisor=true');
  }
  return `node ${shellQuote(config.supervisorScriptPath)} ${cmd}`;
}

/**
 * Canonical launcher script generator.
 *
 * Takes a typed LauncherConfig and returns a bash script string.
 * Callers are responsible for building providerExports, cavemanExports,
 * and baseCommand strings — the generator does NOT call helper functions
 * internally (keeps coupling low, tests simple).
 */
export function generateLauncherScriptSync(config: LauncherConfig): string {
  const lines: string[] = [];

  // Shebang
  lines.push('#!/bin/bash');

  // Strip tmux/screen host-shell artifacts so nested tmux operations don't fail
  // with "sessions should be nested with care" (PAN-912).
  lines.push('unset TMUX TMUX_PANE STY');

  // Pipefail
  if (config.setPipefail) {
    lines.push('set -o pipefail');
  }

  // Trust mkcert CA so agent CLI commands can reach https://pan.localhost
  lines.push('command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"');

  // PAN-1678: skip the heavy ~10-core build:docs-index job in any `npm run
  // build` an agent runs in its session. The docs search index is irrelevant
  // to whether an issue's code compiles/tests, and building it across many
  // concurrent agent workspaces stampedes the host to OOM. Release/publish
  // builds the index through a separate path that never sources this launcher.
  lines.push('export SKIP_DOCS_INDEX=1');

  // Terminal env (TERM/COLORTERM/LANG/LC_ALL)
  if (config.setTerminalEnv) {
    lines.push('export TERM=xterm-256color');
    lines.push('export COLORTERM=truecolor');
    lines.push('export LANG=C.UTF-8');
    lines.push('export LC_ALL=C.UTF-8');
    // Claude Code `theme: auto` fallback when its OSC 11 background query
    // goes unanswered: COLORFGBG bg index 15 = light terminal, 0 = dark.
    // Captured at spawn time from the dashboard theme, mirroring the tmux
    // pane-bg stamp in createSession() (the OSC 11 primary path).
    lines.push(`export COLORFGBG='${colorFgBgForTheme(getUiThemeSync())}'`);
  }

  // Remote PATH
  if (config.setRemotePath) {
    lines.push('export PATH="/usr/local/bin:$PATH"');
  }

  // Track which Overdeck env vars are explicitly set so unsetOverdeckEnv
  // can avoid clearing them (review agent pins agentId but clears issueId/type).
  const explicitlySetOverdeckKeys = new Set<string>();

  // Overdeck env vars
  if (config.overdeckEnv) {
    if (config.overdeckEnv.agentId != null) {
      lines.push(`export OVERDECK_AGENT_ID=${shellQuote(config.overdeckEnv.agentId)}`);
      explicitlySetOverdeckKeys.add('OVERDECK_AGENT_ID');
    }
    if (config.overdeckEnv.issueId != null) {
      lines.push(`export OVERDECK_ISSUE_ID=${shellQuote(config.overdeckEnv.issueId)}`);
      explicitlySetOverdeckKeys.add('OVERDECK_ISSUE_ID');
    }
    if (config.overdeckEnv.sessionType != null) {
      lines.push(`export OVERDECK_SESSION_TYPE=${shellQuote(config.overdeckEnv.sessionType)}`);
      explicitlySetOverdeckKeys.add('OVERDECK_SESSION_TYPE');
    }
  }

  // Extra env exports
  if (config.extraEnvExports) {
    for (const expr of config.extraEnvExports) {
      lines.push(expr);
    }
  }

  // Codex: per-agent CODEX_HOME so each agent has isolated sessions/config
  if (config.codexHome) {
    lines.push(`export CODEX_HOME=${shellQuote(config.codexHome)}`);
  }

  // Change directory (after env setup, before command)
  if (config.changeDir !== false) {
    lines.push(`cd -- ${shellQuote(config.workingDir)}`);
  }

  // Unset provider env (must happen before re-exporting)
  if (config.unsetProviderEnv) {
    for (const key of PROVIDER_ENV_UNSETS) {
      lines.push(`unset ${key}`);
    }
  }

  // Provider exports
  if (config.providerExports) {
    const trimmed = config.providerExports.trimEnd();
    if (trimmed) {
      lines.push(trimmed);
    }
  }

  // Caveman exports
  if (config.cavemanExports) {
    const trimmed = config.cavemanExports.trimEnd();
    if (trimmed) {
      lines.push(trimmed);
    }
  }

  // Unset Overdeck env (review agent — prevents parent attribution)
  if (config.unsetOverdeckEnv) {
    const keysToUnset = ['OVERDECK_AGENT_ID', 'OVERDECK_ISSUE_ID', 'OVERDECK_SESSION_TYPE']
      .filter(k => !explicitlySetOverdeckKeys.has(k));
    if (keysToUnset.length > 0) {
      lines.push(`unset ${keysToUnset.join(' ')}`);
    }
  }

  // Trap HUP
  if (config.trapHup) {
    lines.push("trap '' HUP");
  }

  // Prompt file read
  if (config.promptFile && config.promptFileMode !== 'stdin') {
    lines.push(`prompt=$(cat ${shellQuote(config.promptFile)})`);
  }

  // Debug log — start
  if (config.debugLog) {
    lines.push(`echo "[launcher] Claude starting at $(date)" >> ${shellQuote(config.debugLog)}`);
  }

  // Build the main command
  const commandParts = buildCommand(config);
  if (commandParts.length > 0) {
    lines.push(...commandParts);
  }

  // Debug log — exit
  if (config.debugLog) {
    lines.push('CLAUDE_EXIT=$?');
    lines.push(`echo "[launcher] Claude exited with code $CLAUDE_EXIT at $(date)" >> ${shellQuote(config.debugLog)}`);
  }

  // Post-exit echo messages
  if (config.role === 'plan') {
    lines.push('echo ""');
    lines.push('echo "Planning agent has exited. Session kept alive for review."');
    lines.push('echo "Click \'Done\' in the dashboard when ready to hand off to implementation."');
    if (config.debugLog) {
      lines.push(`echo "[launcher] Keep-alive loop starting at $(date)" >> ${shellQuote(config.debugLog)}`);
    }
  }

  if (config.spawnMode === 'conversation') {
    lines.push('echo ""');
    lines.push('echo "Conversation session ended. Close this panel or click Resume to start a new session."');
  }

  // Keep-alive loop
  if (config.keepAlive) {
    lines.push('while true; do sleep 60; done');
  }

  let script = lines.join('\n') + '\n';

  if (config.escapeForBase64) {
    script = script.replace(/\$/g, '\\$');
  }

  return script;
}

/**
 * Generate the outer `script -qfaec` wrapper for launchers that need tty logging.
 * Returns null if useScriptWrapper is false.
 */
export function generateLauncherWrapperSync(config: LauncherConfig): string | null {
  if (!config.useScriptWrapper || !config.scriptLogFile) {
    return null;
  }

  const inner = (config.innerScriptPath ?? `${config.workingDir}/run-claude.sh`).replace(/'/g, "'\\'");
  return `#!/bin/bash\nexec script -qfaec "bash '${inner}'" ${shellQuote(config.scriptLogFile)}\n`;
}

/** Env vars that may leak from a parent tmux server and must be unset. */
const PROVIDER_ENV_UNSETS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
];

function buildCommand(config: LauncherConfig): string[] {
  const parts: string[] = [];

  if (config.spawnMode === 'conversation') {
    if (config.harness === 'ohmypi') {
      return buildOhmypiCommand(config, false);
    }
    if (config.harness === 'codex') {
      return buildCodexCommand(config, false);
    }


    // Conversation panel doesn't use exec — it runs the command then loops
    if (config.baseCommand) {
      let cmd = config.baseCommand;
      cmd += buildChannelsArgs(config);
      const args: string[] = [];
      if (config.resumeSessionId) {
        args.push(`--resume ${shellQuote(config.resumeSessionId)}`);
      } else if (config.sessionId) {
        args.push(`--session-id ${shellQuote(config.sessionId)}`);
      }
      if (config.extraArgs) {
        args.push(config.extraArgs);
      }
      parts.push(wrapWithSupervisor(config, `${cmd} ${args.join(' ')}`.trim()));
    }
    return parts;
  }

  if (config.role === 'plan') {
    return buildNonConversationCommand(config, false);
  }

  // Review sub-roles (PAN-977): the launcher owns the synthesis signal. It runs
  // claude as a child (not exec) so the post-run contract block can inspect the
  // outcome and signal exactly once.
  if (config.reviewSignal) {
    return buildReviewSubRoleCommand(config);
  }

  // All other launchers use exec
  return buildNonConversationCommand(config, true);
}

/**
 * Build the review sub-role command sequence (PAN-977).
 *
 * The reviewer runs under `timeout` as a child process; once it exits, the
 * launcher itself signals the synthesis agent deterministically — the agent
 * never has to remember to run `pan tell`, and the signal is tied to process
 * exit rather than agent good behavior or Deacon patrol timing.
 */
function buildReviewSubRoleCommand(config: LauncherConfig): string[] {
  const sig = config.reviewSignal!;
  const inner = buildNonConversationCommand(config, false);
  if (inner.length === 0) return inner;

  const claudeCmd = `timeout ${sig.timeoutSeconds} ${inner[0]}`;
  const synth = shellQuote(sig.synthesisAgentId);
  const out = sig.outputPath;
  const role = sig.subRole;
  const pidFile = shellQuote(sig.launcherPidPath);

  return [
    // Record this launcher's pid so Deacon's convoy watchdog can check the
    // launcher process itself for liveness — the tmux session is short-lived
    // and `trap '' HUP` keeps this bash alive after the session is reaped.
    `echo $$ > ${pidFile}`,
    claudeCmd,
    'CLAUDE_EXIT=$?',
    `if [ "$CLAUDE_EXIT" = "124" ]; then`,
    `  pan tell ${synth} "REVIEWER_TIMEOUT ${role} reviewer exceeded ${sig.timeoutSeconds}s deadline" || true`,
    `elif [ -s ${shellQuote(out)} ]; then`,
    `  pan tell ${synth} "REVIEWER_READY ${role} ${out}" || true`,
    `else`,
    `  pan tell ${synth} "REVIEWER_FAILED ${role} reviewer exited (code $CLAUDE_EXIT) without writing report" || true`,
    `fi`,
    `touch ${shellQuote(sig.signalMarkerPath)}`,
    `rm -f ${pidFile}`,
  ];
}

/**
 * Shared command builder for planning and exec-based agent types.
 * Appends session args, extra args, and prompt references.
 *
 * PAN-982: When `baseCommand` contains `--agent` (i.e. an agent definition
 * is selecting permissions, model, and tools via `.claude/agents/pan-*.md`
 * frontmatter), permission flags are skipped — the frontmatter handles them.
 */
function buildNonConversationCommand(config: LauncherConfig, useExec: boolean): string[] {
  if (config.harness === 'ohmypi') {
    return buildOhmypiCommand(config, useExec);
  }
  if (config.harness === 'codex') {
    return buildCodexCommand(config, useExec);
  }

  const parts: string[] = [];
  if (!config.baseCommand) return parts;

  let cmd = config.baseCommand;
  const usesAgentFlag = cmd.includes('--agent ');

  // Append permission flags only when --agent is NOT handling permissions via frontmatter.
  if (!usesAgentFlag && config.permissionFlags && config.permissionFlags.length > 0) {
    const cmdTokens = cmd.split(/\s+/);
    for (const flag of config.permissionFlags) {
      if (!cmdTokens.includes(flag)) {
        cmd += ` ${flag}`;
      }
    }
  }

  // Append channels bridge args (no-op when channelsBridgeMcpConfig unset)
  cmd += buildChannelsArgs(config);

  // Append session args
  if (config.resumeSessionId) {
    cmd += ` --resume ${shellQuote(config.resumeSessionId)}`;
  }
  if (config.sessionId) {
    cmd += ` --session-id ${shellQuote(config.sessionId)}`;
  }
  if (config.model) {
    cmd += ` --model ${shellQuoteModelIdSync(config.model)}`;
  }
  if (config.extraArgs) {
    cmd += ` ${config.extraArgs}`;
  }
  // PAN-1201: fold the layered workspace context bundle into the system prompt.
  for (const file of systemPromptFiles(config)) {
    cmd += ` --append-system-prompt-file ${shellQuote(file)}`;
  }

  // Append prompt reference
  if (config.promptFile) {
    if (config.promptFileMode === 'stdin') {
      cmd += ` < ${shellQuote(config.promptFile)}`;
    } else {
      cmd += ' "$prompt"';
    }
  }
  if (config.promptInline) {
    cmd += ` ${shellQuote(config.promptInline)}`;
  }

  const wrapped = wrapWithSupervisor(config, cmd.trim());
  parts.push(useExec ? `exec ${wrapped}` : wrapped);
  return parts;
}

/**
 * Build an oh-my-pi (omp) command line (PAN-1989).
 *
 * RPC mode (work-agents):
 *   omp --mode rpc \
 *      --model <model> \
 *      --session-dir <piSessionDir> \
 *      --extension <piExtensionPath> \
 *      [--resume <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"] \
 *      <> <piFifoPath> >> <agentDir>/output.log 2>&1
 *
 * TUI mode (conversations):
 *   omp --model <model> \
 *      --session-dir <piSessionDir> \
 *      [--extension <piExtensionPath>] \
 *      [--resume <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"]
 *
 * Contract differences from pi (docs/ohmypi-contract.md):
 * - Binary is `omp`, not `pi`
 * - `--no-context-files` is REMOVED (flag does not exist in omp)
 * - `--resume <id>` replaces `--session <id>`
 */
function buildOhmypiCommand(config: LauncherConfig, useExec: boolean): string[] {
  const piMode = config.piMode ?? 'rpc';
  if (!config.piSessionDir) {
    throw new Error('ohmypi launcher requires piSessionDir');
  }
  if (piMode === 'rpc') {
    if (!config.piExtensionPath) {
      throw new Error('ohmypi launcher (rpc mode) requires piExtensionPath');
    }
    if (!config.piFifoPath) {
      throw new Error('ohmypi launcher (rpc mode) requires piFifoPath');
    }
  }

  const tokens: string[] = ['omp'];
  if (piMode === 'rpc') {
    tokens.push('--mode', 'rpc');
  }
  if (config.model) {
    tokens.push('--model', shellQuoteModelIdSync(qualifyPiModel(config.model)));
  }
  tokens.push('--session-dir', shellQuote(config.piSessionDir));
  if (config.piExtensionPath) {
    tokens.push('--extension', shellQuote(config.piExtensionPath));
  }
  // NOTE: --no-context-files is intentionally absent — removed in omp (docs/ohmypi-contract.md).

  for (const file of systemPromptFiles(config)) {
    tokens.push('--append-system-prompt', `"$(cat ${shellQuote(file)} 2>/dev/null)"`);
  }

  if (config.resumeSessionId) {
    tokens.push('--resume', shellQuote(config.resumeSessionId));
  }
  if (config.extraArgs) {
    tokens.push(config.extraArgs);
  }
  if (config.promptFile) {
    tokens.push('--append-system-prompt', '"$prompt"');
  } else if (config.promptInline) {
    tokens.push('--append-system-prompt', shellQuote(config.promptInline));
  }

  let cmd = tokens.join(' ').replace(/\s+/g, ' ').trim();

  if (piMode === 'rpc') {
    const outputLogPath = join(dirname(config.piFifoPath!), 'output.log');
    cmd = `${cmd} <> ${shellQuote(config.piFifoPath!)} >> ${shellQuote(outputLogPath)} 2>&1`;
  }

  return [useExec ? `exec ${cmd}` : cmd];
}

/**
 * Build a Pi command line.
 *
 * RPC mode (work-agents):
 *   pi --mode rpc \
 *      --model <model> \
 *      --session-dir <piSessionDir> \
 *      --extension <piExtensionPath> \
 *      --no-context-files \
 *      [--session <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"] \
 *      <> <piFifoPath>
 *
 * TUI mode (conversations):
 *   pi --model <model> \
 *      --session-dir <piSessionDir> \
 *      [--extension <piExtensionPath>] \
 *      --no-context-files \
 *      [--session <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"]
 *
 * Pi has no permission system, so permissionFlags are intentionally
 * dropped (AC4). baseCommand is ignored — Pi launchers always start with
 * the literal `pi` so callers cannot accidentally smuggle in claude flags.
 */
function systemPromptFiles(config: LauncherConfig): string[] {
  return [
    ...(config.appendSystemPromptFile ? [config.appendSystemPromptFile] : []),
    ...(config.appendSystemPromptFiles ?? []),
  ];
}

function buildCodexCommand(config: LauncherConfig, useExec: boolean): string[] {
  const cmd = computeCodexCommandTokens(config, useExec);
  // PAN-1988 — log the resolved codex invocation so a "resume started over instead of continuing"
  // regression is one `grep '[codex-launcher]'` away: it shows the mode, the resume id we were
  // handed, and whether `resume <id>` actually made it into the command for that mode. This is the
  // log that would have caught the work-tui branch silently dropping resumeSessionId.
  const flat = cmd.join(' ').replace(/\s+/g, ' ');
  const applied = /(^|\s)resume(\s|$)/.test(flat) ? 'YES' : 'no';
  console.log(
    `[codex-launcher] agent=${config.overdeckEnv?.agentId ?? '?'} mode=${config.codexMode ?? 'exec'} ` +
    `resumeSessionId=${config.resumeSessionId ?? '(none)'} resumeApplied=${applied} cmd=${flat.slice(0, 200)}`,
  );
  return cmd;
}

function computeCodexCommandTokens(config: LauncherConfig, useExec: boolean): string[] {
  const codexMode = config.codexMode ?? 'exec';

  // TUI / conversation mode: interactive terminal, optionally under the PTY
  // supervisor for conversation delivery. Keep CODEX_HOME/AGENTS.md, but do
  // not let repo AGENTS.md turn a normal dashboard conversation into a work
  // agent with project-level task-tracker rules.
  if (codexMode === 'tui') {
    const tokens: string[] = ['codex'];
    if (config.resumeSessionId) {
      tokens.push('resume');
    }
    tokens.push('-c', 'project_doc_max_bytes=0');
    if (config.resumeSessionId) {
      tokens.push(shellQuote(config.resumeSessionId));
    }
    const cmd = wrapWithSupervisor(config, tokens.join(' '));
    return [useExec ? `exec ${cmd}` : cmd];
  }

  if (codexMode === 'work-tui') {
    // PAN-1803: approval_policy and sandbox_mode come from the per-agent
    // config.toml that initCodexHome seeds from the user's Settings →
    // Permissions → Codex level (getCodexLauncherFields). Do NOT pass `-s` or
    // `-c approval_policy=` on the CLI — those override config.toml and would
    // ignore the Settings choice. Mirror the conversation path (codexMode
    // 'tui'), which relies entirely on the seeded config.toml. Only `-m`
    // (per-agent model) is passed here.
    const tokens: string[] = ['codex'];
    // PAN-1988: apply the resume id so a re-dispatched work/review agent CONTINUES its codex thread
    // (keeping the prior round's context) instead of opening a fresh TUI session. `codex resume
    // <id>` mirrors the 'tui' branch — the bug was that work-tui dropped resumeSessionId entirely,
    // so every re-review started over and re-researched the whole diff.
    if (config.resumeSessionId) {
      tokens.push('resume');
    }
    if (config.model) {
      tokens.push('-m', shellQuoteModelIdSync(config.model));
    }
    if (config.resumeSessionId) {
      tokens.push(shellQuote(config.resumeSessionId));
    }
    const cmd = wrapWithSupervisor(config, tokens.join(' '));
    return [useExec ? `exec ${cmd}` : cmd];
  }

  const isResume = Boolean(config.resumeSessionId);

  // Headless exec mode — fresh spawn or resume.
  // Resume: `codex exec resume <threadId> [prompt]`
  //   Note: `codex exec resume` rejects -s; sandbox must be set via -c.
  // Fresh: `codex exec [-m model] -c approval_policy=never -s sandbox --skip-git-repo-check [prompt]`
  const tokens: string[] = ['codex', 'exec'];
  if (isResume) {
    tokens.push('resume');
  }

  if (config.model) {
    tokens.push('-m', shellQuoteModelIdSync(config.model));
  }

  // Disable approval prompts (codex exec rejects --ask-for-approval; use -c instead)
  tokens.push('-c', 'approval_policy=never');

  // Sandbox mode: translate Overdeck's abstract 'workspace' token to the
  // codex CLI's 'workspace-write' (PAN-1799 — raw 'workspace' is rejected and
  // the agent dies at boot). Resume path uses -c (not -s) because
  // `codex exec resume` rejects -s.
  const sandbox = toCodexSandboxValue(config.codexSandboxMode);
  if (isResume) {
    tokens.push('-c', `sandbox_mode=${sandbox}`);
  } else {
    tokens.push('-s', sandbox);
  }

  tokens.push('--skip-git-repo-check');

  if (isResume) {
    tokens.push(shellQuote(config.resumeSessionId!));
  }

  if (config.promptFile) {
    tokens.push('"$prompt"');
  } else if (config.promptInline) {
    tokens.push(shellQuote(config.promptInline));
  }

  let cmd = tokens.join(' ').replace(/\s+/g, ' ').trim();
  return [useExec ? `exec ${cmd}` : cmd];
}

function buildPiCommand(config: LauncherConfig, useExec: boolean): string[] {
  const piMode = config.piMode ?? 'rpc';
  if (!config.piSessionDir) {
    throw new Error('Pi launcher requires piSessionDir');
  }
  if (piMode === 'rpc') {
    if (!config.piExtensionPath) {
      throw new Error('Pi launcher (rpc mode) requires piExtensionPath');
    }
    if (!config.piFifoPath) {
      throw new Error('Pi launcher (rpc mode) requires piFifoPath');
    }
  }

  const tokens: string[] = ['pi'];
  if (piMode === 'rpc') {
    tokens.push('--mode', 'rpc');
  }
  if (config.model) {
    // Provider-qualify so Pi binds the model to the intended provider
    // (bare 'kimi-k2.6' resolves to keyless moonshotai instead of
    // kimi-coding — agent boots but every prompt fails; PAN-1799).
    tokens.push('--model', shellQuoteModelIdSync(qualifyPiModel(config.model)));
  }
  tokens.push('--session-dir', shellQuote(config.piSessionDir));
  if (config.piExtensionPath) {
    tokens.push('--extension', shellQuote(config.piExtensionPath));
  }
  tokens.push('--no-context-files');

  // PAN-1566: deliver Overdeck's injected context (global engineering-rules
  // layer, workspace/briefing) via --append-system-prompt. The pi-extension
  // session_start fold cannot do this — @earendil-works/pi-coding-agent's ctx
  // exposes no appendSystemPrompt method, so that path silently no-ops. The CLI
  // flag reads the file CONTENTS at launch via bash command substitution and is
  // the reliable delivery path; absent/empty files contribute nothing.
  for (const file of systemPromptFiles(config)) {
    tokens.push('--append-system-prompt', `"$(cat ${shellQuote(file)} 2>/dev/null)"`);
  }

  if (config.resumeSessionId) {
    tokens.push('--session', shellQuote(config.resumeSessionId));
  }
  if (config.extraArgs) {
    tokens.push(config.extraArgs);
  }
  if (config.promptFile) {
    tokens.push('--append-system-prompt', '"$prompt"');
  } else if (config.promptInline) {
    tokens.push('--append-system-prompt', shellQuote(config.promptInline));
  }

  let cmd = tokens.join(' ').replace(/\s+/g, ' ').trim();

  if (piMode === 'rpc') {
    // stdin redirection from the per-agent fifo. Pi reads JSONL RPC commands
    // from stdin in --mode rpc. Use bash read-write redirection (`<>`) instead
    // of read-only (`<`): opening a FIFO read-only blocks until a writer is
    // present, which means Pi could never exec and never write `ready.json`
    // before any external writer attached, deadlocking work-agent launches.
    // `<>` opens the FIFO without blocking, lets Pi start, emit its ready
    // marker, and then read JSONL commands as the dashboard writer pushes them.
    cmd = `${cmd} <> ${shellQuote(config.piFifoPath!)}`;
  }
  // TUI mode: leave stdin attached to the tmux pane so the user (or paste-buffer
  // delivery from the dashboard) can type into Pi directly.

  return [useExec ? `exec ${cmd}` : cmd];
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync launcher emission — additive Effect.sync wrappers.

/** Build the bash launcher script body for a Cloister role spawn. Pure. */
export const generateLauncherScript = (
  config: LauncherConfig,
): Effect.Effect<string> => Effect.sync(() => generateLauncherScriptSync(config));

/** Build an optional launcher wrapper (returns null when not needed). Pure. */
export const generateLauncherWrapper = (
  config: LauncherConfig,
): Effect.Effect<string | null> => Effect.sync(() => generateLauncherWrapperSync(config));
