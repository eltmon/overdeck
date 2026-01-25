import { execSync } from 'child_process';
import { writeFileSync, chmodSync } from 'fs';

export interface TmuxSession {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
}

export function listSessions(): TmuxSession[] {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}|#{session_created}|#{session_attached}|#{session_windows}"', {
      encoding: 'utf8',
    });

    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, created, attached, windows] = line.split('|');
      return {
        name,
        created: new Date(parseInt(created) * 1000),
        attached: attached === '1',
        windows: parseInt(windows),
      };
    });
  } catch {
    return []; // No sessions
  }
}

export function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export function createSession(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string> }
): void {
  const escapedCwd = cwd.replace(/"/g, '\\"');

  // Build environment variable flags for tmux
  let envFlags = '';
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      envFlags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
    }
  }

  // For complex commands (with special chars), start session first then send command
  if (initialCommand && (initialCommand.includes('`') || initialCommand.includes('\n') || initialCommand.length > 500)) {
    // Create session without command
    execSync(`tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags}`);

    // Small delay to let session initialize
    execSync('sleep 0.5');

    // Send the command in chunks if needed (tmux has buffer limits)
    // First, write to a temp file and source it
    const tmpFile = `/tmp/pan-cmd-${name}.sh`;
    writeFileSync(tmpFile, initialCommand);
    chmodSync(tmpFile, '755');

    // Execute the script
    execSync(`tmux send-keys -t ${name} "bash ${tmpFile}"`);
    execSync(`tmux send-keys -t ${name} C-m`);
  } else if (initialCommand) {
    // Simple command - use inline
    const cmd = `tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags} "${initialCommand.replace(/"/g, '\\"')}"`;
    execSync(cmd);
  } else {
    execSync(`tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags}`);
  }
}

export function killSession(name: string): void {
  execSync(`tmux kill-session -t ${name}`);
}

export function sendKeys(sessionName: string, keys: string): void {
  // CRITICAL: Send keys and Enter as separate commands
  // This is the correct way - combining them doesn't work
  const escapedKeys = keys.replace(/"/g, '\\"');
  execSync(`tmux send-keys -t ${sessionName} "${escapedKeys}"`);
  execSync(`tmux send-keys -t ${sessionName} C-m`);
}

export function capturePane(sessionName: string, lines: number = 50): string {
  try {
    return execSync(`tmux capture-pane -t ${sessionName} -p -S -${lines}`, {
      encoding: 'utf8',
    });
  } catch {
    return '';
  }
}

export function getAgentSessions(): TmuxSession[] {
  return listSessions().filter(s => s.name.startsWith('agent-'));
}
