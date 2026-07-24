import type {
  ComposerCommandPolicy,
  ComposerCommandResult,
} from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import { runCapturedCommand } from './executors.js';
import type { ParsedOverdeckComposerCommand } from './parser.js';
import { resolvePolicy } from './policy.js';

export interface ComposerCommandTarget {
  kind: 'conversation' | 'agent';
  id: string;
  harness: RuntimeName;
  cwd?: string;
  issueId?: string;
}

export interface HandleComposerCommandInput {
  parsed: ParsedOverdeckComposerCommand;
  target: ComposerCommandTarget;
}

export async function handleComposerCommand({
  parsed,
  target,
}: HandleComposerCommandInput): Promise<ComposerCommandResult> {
  const policy = resolvePolicy(parsed.entry.path);
  void target;

  if (policy.mode === 'captured') {
    return runCapturedCommand(parsed.argv);
  }
  if (policy.mode === 'terminal-only') {
    return {
      kind: 'terminal-only',
      status: 'rejected',
      message: `${parsed.entry.display} must run in a terminal. Composer execution has not been enabled for this command.`,
    };
  }

  return missingExecutorResult(parsed.entry.display, policy);
}

function missingExecutorResult(
  display: string,
  policy: ComposerCommandPolicy,
): ComposerCommandResult {
  return {
    kind: 'terminal-only',
    status: 'rejected',
    message: `${display} is recognized as a ${policy.mode} command, but its composer executor is not registered yet. Run it in a terminal for now.`,
  };
}

export function composerCommandResultHttpStatus(result: ComposerCommandResult): number {
  return result.kind === 'terminal-only' ? 422 : 200;
}
