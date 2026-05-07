export type LauncherAgentType =
  | 'work'
  | 'planning'
  | 'specialist-dispatch'
  | 'specialist-init'
  | 'review'
  | 'conversation'
  | 'remote'
  | 'runtime'
  | 'resume';

export interface LauncherConfig {
  agentType: LauncherAgentType;
  workingDir: string;

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
}

/**
 * Quote a string for safe use as a shell literal in single quotes.
 * e.g. shellQuote("foo'bar") → "'foo'\\''bar'"
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\''`)}'`;
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
  if (config.agentType === 'planning') {
    lines.push('echo ""');
    lines.push('echo "Planning agent has exited. Session kept alive for review."');
    lines.push('echo "Click \'Done\' in the dashboard when ready to hand off to implementation."');
    if (config.debugLog) {
      lines.push(`echo "[launcher] Keep-alive loop starting at $(date)" >> ${shellQuote(config.debugLog)}`);
    }
  }

  if (config.agentType === 'conversation') {
    lines.push('echo ""');
    lines.push('echo "Conversation session ended. Close this panel or click Resume to start a new session."');
  }

  // Specialist completion signal
  if (config.agentType === 'specialist-dispatch') {
    lines.push('echo ""');
    lines.push('echo "## Specialist completed task"');
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
 * Generate the outer `script -qfaec` wrapper for specialist dispatch.
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

  if (config.agentType === 'conversation') {
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

  if (config.agentType === 'specialist-dispatch') {
    // Inner script: no exec, runs claude directly then echoes completion
    if (config.baseCommand) {
      let cmd = config.baseCommand;

      if (config.sessionId) {
        cmd += ` --session-id ${shellQuote(config.sessionId)}`;
      }
      if (config.model) {
        cmd += ` --model ${config.model}`;
      }
      if (config.permissionFlags && config.permissionFlags.length > 0) {
        const cmdTokens = cmd.split(/\s+/);
        for (const flag of config.permissionFlags) {
          if (!cmdTokens.includes(flag)) {
            cmd += ` ${flag}`;
          }
        }
      }
      if (config.promptFile) {
        cmd += ' "$prompt"';
      }

      parts.push(cmd.trim().replace(/\s+/g, ' '));
    }
    return parts;
  }

  if (config.agentType === 'planning') {
    return buildNonConversationCommand(config, false);
  }

  // All other types use exec
  return buildNonConversationCommand(config, true);
}

/**
 * Shared command builder for planning and exec-based agent types.
 * Appends session args, extra args, and prompt references.
 *
 * PAN-982: When `baseCommand` contains `--agent` (i.e. an agent definition
 * is selecting permissions, model, and tools via `.claude/agents/pan-*.md`
 * frontmatter), permission flags are skipped — the frontmatter handles them.
 * Specialists not yet migrated to --agent (e.g. specialist-init for review
 * canonical sessions) still pass permissionFlags and get them emitted.
 */
function buildNonConversationCommand(config: LauncherConfig, useExec: boolean): string[] {
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
