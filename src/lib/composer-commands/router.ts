import type {
  ComposerCommandPolicy,
  ComposerCommandResult,
} from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import { runDetachedCommand } from './detached.js';
import { runCapturedCommand } from './executors.js';
import {
  parseOverdeckComposerCommand,
  type ParsedOverdeckComposerCommand,
} from './parser.js';
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

export interface HandleComposerCommandMessageInput {
  message: string;
  target: ComposerCommandTarget;
}

const UI_COMMAND_PATTERNS = [
  {
    action: 'handoff' as const,
    pattern: /^\/(?:handoff|pan-handoff|pan\s+handoff)(?:\s+([\s\S]+))?$/i,
  },
  {
    action: 'fork' as const,
    pattern: /^\/pan\s+fork(?:\s+([\s\S]+))?$/i,
  },
];

export function isComposerCommandMessage(message: string): boolean {
  return (
    UI_COMMAND_PATTERNS.some(({ pattern }) => pattern.test(message)) ||
    /^\/pan(?:\s|$)/.test(message)
  );
}

export async function handleComposerCommandMessage({
  message,
  target,
}: HandleComposerCommandMessageInput): Promise<ComposerCommandResult | null> {
  for (const { action, pattern } of UI_COMMAND_PATTERNS) {
    const match = message.match(pattern);
    if (match) return uiCommandResult(action, match[1]?.trim());
  }

  const parsed = parseOverdeckComposerCommand(message);
  if (parsed === null) return null;
  return handleComposerCommand({ parsed, target });
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
  if (policy.mode === 'detached') {
    return runDetachedCommand(parsed.argv);
  }
  if (policy.mode === 'ui' && policy.uiAction) {
    return uiCommandResult(
      policy.uiAction,
      parsed.argv.slice(parsed.entry.path.length).join(' ') || undefined,
    );
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

function uiCommandResult(
  action: 'handoff' | 'fork',
  focus: string | undefined,
): ComposerCommandResult {
  return {
    kind: 'ui',
    status: 'requires_ui',
    action,
    args: focus ? { focus } : {},
  };
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
