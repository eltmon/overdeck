import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RuntimeName } from '../runtimes/types.js';
import { getAgentDir } from './agent-state.js';

export interface PinnedAgentLaunch {
  sessionId: string;
  model: string;
  harness: RuntimeName;
}

function parseFlagValue(content: string, flag: '--model' | '-m'): string | null {
  const escapedFlag = flag.replace('-', '\\-');
  const quoted = content.match(new RegExp(`${escapedFlag}\\s+'([^']+)'`))
    ?? content.match(new RegExp(`${escapedFlag}\\s+"([^"]+)"`));
  if (quoted?.[1]) return quoted[1];
  return content.match(new RegExp(`${escapedFlag}\\s+([^\\s'"\\\\]+)`))?.[1] ?? null;
}

export function parsePinnedAgentLaunch(
  launcher: string,
  sessionId: string,
): PinnedAgentLaunch | null {
  const pinnedSessionId = sessionId.trim();
  if (!pinnedSessionId) return null;

  const harness: RuntimeName | null = launcher.includes('codex-app-server-host.js')
    || /(?:^|\s)(?:exec\s+)?codex(?:\s|$)/m.test(launcher)
    ? 'codex'
    : /(?:^|\s)(?:exec\s+)?omp\s+--mode\s+rpc(?:\s|$)/m.test(launcher)
      ? 'ohmypi'
      : /(?:^|\s)claude(?:\s|$)/m.test(launcher)
        ? 'claude-code'
        : null;
  const model = parseFlagValue(launcher, '--model') ?? parseFlagValue(launcher, '-m');
  if (!harness || !model || model.startsWith('pending-')) return null;

  return { sessionId: pinnedSessionId, model, harness };
}

export function readPinnedAgentLaunchSync(agentId: string): PinnedAgentLaunch | null {
  const agentDir = getAgentDir(agentId);
  const launcherPath = join(agentDir, 'launcher.sh');
  const sessionIdPath = join(agentDir, 'session.id');
  if (!existsSync(launcherPath) || !existsSync(sessionIdPath)) return null;

  try {
    return parsePinnedAgentLaunch(
      readFileSync(launcherPath, 'utf8'),
      readFileSync(sessionIdPath, 'utf8'),
    );
  } catch {
    return null;
  }
}
