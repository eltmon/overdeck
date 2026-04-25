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

  // Pipefail
  if (config.setPipefail) {
    lines.push('set -o pipefail');
  }

  // CI
  if (config.setCi) {
    lines.push('export CI=1');
  }

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

  // Panopticon env vars
  if (config.panopticonEnv) {
    if (config.panopticonEnv.agentId != null) {
      lines.push(`export PANOPTICON_AGENT_ID="${config.panopticonEnv.agentId}"`);
    }
    if (config.panopticonEnv.issueId != null) {
      lines.push(`export PANOPTICON_ISSUE_ID="${config.panopticonEnv.issueId}"`);
    }
    if (config.panopticonEnv.sessionType != null) {
      lines.push(`export PANOPTICON_SESSION_TYPE="${config.panopticonEnv.sessionType}"`);
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
    lines.push(`cd "${config.workingDir}"`);
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
    lines.push('unset PANOPTICON_AGENT_ID PANOPTICON_ISSUE_ID PANOPTICON_SESSION_TYPE');
  }

  // Trap HUP
  if (config.trapHup) {
    lines.push("trap '' HUP");
  }

  // Prompt file read
  if (config.promptFile) {
    lines.push(`prompt=$(cat "${config.promptFile}")`);
  }

  // Debug log — start
  if (config.debugLog) {
    lines.push(`echo "[launcher] Claude starting at $(date)" >> ${config.debugLog}`);
  }

  // Build the main command
  const commandParts = buildCommand(config);
  if (commandParts.length > 0) {
    lines.push(...commandParts);
  }

  // Debug log — exit
  if (config.debugLog) {
    lines.push('CLAUDE_EXIT=$?');
    lines.push(`echo "[launcher] Claude exited with code $CLAUDE_EXIT at $(date)" >> ${config.debugLog}`);
  }

  // Post-exit echo messages
  if (config.agentType === 'planning') {
    lines.push('echo ""');
    lines.push('echo "Planning agent has exited. Session kept alive for review."');
    lines.push('echo "Click \'Done\' in the dashboard when ready to hand off to implementation."');
    if (config.debugLog) {
      lines.push(`echo "[launcher] Keep-alive loop starting at $(date)" >> ${config.debugLog}`);
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

  const inner = config.innerScriptPath ?? `${config.workingDir}/run-claude.sh`;
  return `#!/bin/bash\nexec script -qfaec "bash '${inner}'" "${config.scriptLogFile}"\n`;
}

/** Env vars that may leak from a parent tmux server and must be unset. */
const PROVIDER_ENV_UNSETS = [
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
        args.push(`--resume "${config.resumeSessionId}"`);
      } else if (config.sessionId) {
        args.push(`--session-id "${config.sessionId}"`);
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
      const args: string[] = [];
      if (config.sessionId) {
        args.push(`--session-id "${config.sessionId}"`);
      }
      if (config.model) {
        args.push(`--model ${config.model}`);
      }
      const permissionFlags = config.permissionFlags?.join(' ') ?? '';
      const promptRef = config.promptFile ? '"$prompt"' : '';
      parts.push(`claude ${permissionFlags} ${args.join(' ')} ${promptRef}`.trim().replace(/\s+/g, ' '));
    }
    return parts;
  }

  // All other types use exec
  if (config.baseCommand) {
    let cmd = config.baseCommand;

    // Append permission flags if not already present
    if (config.permissionFlags && config.permissionFlags.length > 0) {
      const flagsStr = config.permissionFlags.join(' ');
      if (!cmd.includes(flagsStr)) {
        cmd += ` ${flagsStr}`;
      }
    }

    // Append session args
    if (config.resumeSessionId) {
      cmd += ` --resume "${config.resumeSessionId}"`;
    }
    if (config.sessionId) {
      cmd += ` --session-id "${config.sessionId}"`;
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
      cmd += ` "${config.promptInline}"`;
    }

    parts.push(`exec ${cmd.trim()}`);
  }

  return parts;
}
