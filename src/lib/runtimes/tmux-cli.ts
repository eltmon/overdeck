import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function tmuxSessionExists(agentId: string): Promise<boolean> {
  try {
    await execAsync(`tmux -L overdeck has-session -t ${shellQuote(agentId)} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function tmuxKillSession(agentId: string): Promise<void> {
  await execAsync(`tmux -L overdeck kill-session -t ${shellQuote(agentId)} 2>/dev/null || true`);
}

export async function tmuxCreateSession(agentId: string, workspace: string, command: string, env: Record<string, string> = {}): Promise<void> {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
  const wrapped = `${envPrefix ? `env ${envPrefix} ` : ''}bash -lc ${shellQuote(command)}`;
  await execAsync(`tmux -L overdeck new-session -d -s ${shellQuote(agentId)} -c ${shellQuote(workspace)} ${shellQuote(wrapped)}`);
}
