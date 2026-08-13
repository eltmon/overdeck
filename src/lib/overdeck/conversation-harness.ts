import { KNOWN_HARNESSES, type Harness } from '@overdeck/contracts';
import { getPrimeAgentBaseCommand } from '../agents/runtime-command.js';
import { resolveHarness } from '../harness-resolve.js';
import type { RuntimeName } from '../runtimes/types.js';

function isHarness(value: unknown): value is Harness {
  return typeof value === 'string' && KNOWN_HARNESSES.has(value);
}

export async function resolveAllowedHarness(requested: unknown, model?: string | null): Promise<RuntimeName> {
  if (!model) return 'claude-code';
  return resolveHarness({ model, explicit: isHarness(requested) ? requested : undefined });
}

export async function preparePrimeAgentConversationLaunch(tmuxSession: string, cwd: string, model: string): Promise<{
  runtimeCommand: string;
  fields: { harness: 'prime-agent' };
}> {
  return {
    runtimeCommand: await getPrimeAgentBaseCommand(tmuxSession, model, cwd),
    fields: { harness: 'prime-agent' },
  };
}
