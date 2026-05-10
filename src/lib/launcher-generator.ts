import type { Role } from './agents.js';

export type LauncherSpawnMode = 'conversation' | 'remote' | 'resume';

export type LauncherHarness = 'claude-code' | 'pi';

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
  /** Absolute path to packages/pi-extension/dist/index.js. Required for harness='pi'. */
  piExtensionPath?: string;
  /** Absolute path to ~/.panopticon/agents/<id>/rpc.in. Required for harness='pi'. */
  piFifoPath?: string;
  /** Absolute path to per-agent Pi session-dir (Pi --session-dir). Required for harness='pi'. */
  piSessionDir?: string;

  // Command construction
  /**
   * Base command to run (e.g. 'claude', 'claude --model gpt-5.4').
   * For conversation agents this must be a single unquoted token;
   * the generator does NOT tokenize shell-quoted arguments.
   */
  baseCommand?: string;
  promptFile?: string;
  promptInline?: string;
  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  permissionFlags?: string[];
  extraArgs?: string;

  // Env shaping
  setCi?: boolean;
  setTerminalEnv?: boolean;
  providerExports?: string;
  unsetProviderEnv?: boolean;
  cavemanExports?: string;
  panopticonEnv?: { agentId?: string; issueId?: string; sessionType?: string };
  unsetPanopticonEnv?: boolean;
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
   * Absolute path to a per-agent .mcp.json that wires the panopticon-bridge
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
   * Claude Code Channel. Defaults to 'panopticon-bridge' when
   * channelsBridgeMcpConfig is set; ignored when the MCP config path is
   * not also provided.
   */
  channelsBridgeServerName?: string;
}

/**
 * Quote a string for safe use as a shell literal in single quotes.
 * e.g. shellQuote("foo'bar") → "'foo'\\''bar'"
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\''`)}'`;
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
  const serverName = config.channelsBridgeServerName ?? 'panopticon-bridge';
  return ` --mcp-config ${shellQuote(config.channelsBridgeMcpConfig)} --dangerously-load-development-channels server:${serverName}`;
}

/**
 * Canonical launcher script generator.
 *
 * Takes a typed LauncherConfig and returns a bash script string.
 * Callers are responsible for building providerExports, cavemanExports,
 * and baseCommand strings — the generator does NOT call helper functions
 * internally (keeps coupling low, tests simple).
 */
export function generateLauncherScript(config: LauncherConfig): string {
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

  // CI
  if (config.setCi) {
    lines.push('export CI=1');
  }

  // Trust mkcert CA so agent CLI commands can reach https://pan.localhost
  lines.push('command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"');

  // Terminal env (TERM/COLORTERM/LANG/LC_ALL)
  if (config.setTerminalEnv) {
    lines.push('export TERM=xterm-256color');
    lines.push('export COLORTERM=truecolor');
    lines.push('export LANG=C.UTF-8');
    lines.push('export LC_ALL=C.UTF-8');
  }

  // Remote PATH
  if (config.setRemotePath) {
    lines.push('export PATH="/usr/local/bin:$PATH"');
  }

  // Track which Panopticon env vars are explicitly set so unsetPanopticonEnv
  // can avoid clearing them (review agent pins agentId but clears issueId/type).
  const explicitlySetPanopticonKeys = new Set<string>();

  // Panopticon env vars
  if (config.panopticonEnv) {
    if (config.panopticonEnv.agentId != null) {
      lines.push(`export PANOPTICON_AGENT_ID=${shellQuote(config.panopticonEnv.agentId)}`);
      explicitlySetPanopticonKeys.add('PANOPTICON_AGENT_ID');
    }
    if (config.panopticonEnv.issueId != null) {
      lines.push(`export PANOPTICON_ISSUE_ID=${shellQuote(config.panopticonEnv.issueId)}`);
      explicitlySetPanopticonKeys.add('PANOPTICON_ISSUE_ID');
    }
    if (config.panopticonEnv.sessionType != null) {
      lines.push(`export PANOPTICON_SESSION_TYPE=${shellQuote(config.panopticonEnv.sessionType)}`);
      explicitlySetPanopticonKeys.add('PANOPTICON_SESSION_TYPE');
    }
  }

  // Extra env exports
  if (config.extraEnvExports) {
    for (const expr of config.extraEnvExports) {
      lines.push(expr);
    }
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

  // Unset Panopticon env (review agent — prevents parent attribution)
  if (config.unsetPanopticonEnv) {
    const keysToUnset = ['PANOPTICON_AGENT_ID', 'PANOPTICON_ISSUE_ID', 'PANOPTICON_SESSION_TYPE']
      .filter(k => !explicitlySetPanopticonKeys.has(k));
    if (keysToUnset.length > 0) {
      lines.push(`unset ${keysToUnset.join(' ')}`);
    }
  }

  // Trap HUP
  if (config.trapHup) {
    lines.push("trap '' HUP");
  }

  // Prompt file read
  if (config.promptFile) {
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
export function generateLauncherWrapper(config: LauncherConfig): string | null {
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
    // Conversation panel doesn't use exec — it runs the command then loops
    if (config.baseCommand) {
      const args: string[] = [];
      if (config.resumeSessionId) {
        args.push(`--resume ${shellQuote(config.resumeSessionId)}`);
      } else if (config.sessionId) {
        args.push(`--session-id ${shellQuote(config.sessionId)}`);
      }
      if (config.extraArgs) {
        args.push(config.extraArgs);
      }
      parts.push(`${config.baseCommand} ${args.join(' ')}`.trim());
    }
    return parts;
  }

  if (config.role === 'plan') {
    return buildNonConversationCommand(config, false);
  }

  // All other launchers use exec
  return buildNonConversationCommand(config, true);
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
  if (config.harness === 'pi') {
    return buildPiCommand(config, useExec);
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
    cmd += ` --model ${config.model}`;
  }
  if (config.extraArgs) {
    cmd += ` ${config.extraArgs}`;
  }

  // Append prompt reference
  if (config.promptFile) {
    cmd += ' "$prompt"';
  }
  if (config.promptInline) {
    cmd += ` ${shellQuote(config.promptInline)}`;
  }

  parts.push(useExec ? `exec ${cmd.trim()}` : cmd.trim());
  return parts;
}

/**
 * Build a Pi command line.
 *
 *   pi --mode rpc \
 *      --model <model> \
 *      --session-dir <piSessionDir> \
 *      --extension <piExtensionPath> \
 *      --no-context-files \
 *      [--session <resumeSessionId>] \
 *      [--append-system-prompt "$prompt"] \
 *      < <piFifoPath>
 *
 * Pi has no permission system, so permissionFlags are intentionally
 * dropped (AC4). baseCommand is ignored — Pi launchers always start with
 * the literal `pi` so callers cannot accidentally smuggle in claude flags.
 */
function buildPiCommand(config: LauncherConfig, useExec: boolean): string[] {
  if (!config.piExtensionPath) {
    throw new Error('Pi launcher requires piExtensionPath');
  }
  if (!config.piFifoPath) {
    throw new Error('Pi launcher requires piFifoPath');
  }
  if (!config.piSessionDir) {
    throw new Error('Pi launcher requires piSessionDir');
  }

  const tokens: string[] = ['pi', '--mode', 'rpc'];
  if (config.model) {
    tokens.push('--model', config.model);
  }
  tokens.push('--session-dir', shellQuote(config.piSessionDir));
  tokens.push('--extension', shellQuote(config.piExtensionPath));
  tokens.push('--no-context-files');

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

  // stdin redirection from the per-agent fifo. Pi reads JSONL RPC commands
  // from stdin in --mode rpc.
  const stdinRedirect = `< ${shellQuote(config.piFifoPath)}`;
  const cmd = `${tokens.join(' ')} ${stdinRedirect}`.replace(/\s+/g, ' ').trim();

  return [useExec ? `exec ${cmd}` : cmd];
}
