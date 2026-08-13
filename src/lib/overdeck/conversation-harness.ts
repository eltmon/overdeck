import { KNOWN_HARNESSES, type Harness } from '@overdeck/contracts';
import { getPrimeAgentBaseCommand } from '../agents/runtime-command.js';
import { getAgentDir } from '../agents/agent-state.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHarness } from '../harness-resolve.js';
import type { RuntimeName } from '../runtimes/types.js';

function isHarness(value: unknown): value is Harness {
  return typeof value === 'string' && KNOWN_HARNESSES.has(value);
}

export async function resolveAllowedHarness(requested: unknown, model?: string | null): Promise<RuntimeName> {
  if (!model) return 'claude-code';
  return resolveHarness({ model, explicit: isHarness(requested) ? requested : undefined });
}

export async function preparePrimeAgentConversationLaunch(tmuxSession: string, cwd: string, model: string, resume = false): Promise<{
  runtimeCommand: string;
  fields: { harness: 'prime-agent'; resumeSessionId?: string };
}> {
  const resumeSessionId = resume
    ? await readFile(join(getAgentDir(tmuxSession), 'prime-agent-session-path'), 'utf8')
      .then(value => value.trim() || undefined)
      .catch(() => undefined)
    : undefined;
  return {
    runtimeCommand: await getPrimeAgentBaseCommand(tmuxSession, model, cwd),
    fields: { harness: 'prime-agent', ...(resumeSessionId ? { resumeSessionId } : {}) },
  };
}
