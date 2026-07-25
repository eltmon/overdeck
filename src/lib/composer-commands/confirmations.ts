import { randomBytes } from 'node:crypto';

import type {
  ComposerCommandPolicy,
  ComposerCommandResult,
  ComposerSafety,
} from '@overdeck/contracts';

export const COMPOSER_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface ComposerConfirmationTarget {
  kind: 'conversation' | 'agent';
  id: string;
}

export interface ComposerCommandConfirmationInput {
  nonce?: unknown;
  typedText?: unknown;
}

export function composerCommandConfirmationFromBody(
  body: Record<string, unknown>,
): ComposerCommandConfirmationInput | undefined {
  if (!('confirmationNonce' in body) && !('confirmationText' in body)) return undefined;
  return {
    nonce: body['confirmationNonce'],
    typedText: body['confirmationText'],
  };
}

interface ComposerConfirmationEntry {
  targetKind: ComposerConfirmationTarget['kind'];
  targetId: string;
  argv: readonly string[];
  safety: ComposerSafety;
  typedText?: string;
  expiresAt: number;
}

export class ComposerCommandConfirmationError extends Error {
  readonly code = 'invalid-confirmation';

  constructor(message: string) {
    super(message);
    this.name = 'ComposerCommandConfirmationError';
  }
}

export interface ComposerConfirmationStore {
  issue(input: {
    target: ComposerConfirmationTarget;
    argv: readonly string[];
    policy: ComposerCommandPolicy;
    display: string;
  }): Extract<ComposerCommandResult, { kind: 'confirmation' }>;
  consume(input: {
    target: ComposerConfirmationTarget;
    argv: readonly string[];
    policy: ComposerCommandPolicy;
    confirmation: ComposerCommandConfirmationInput;
  }): void;
}

export interface ComposerConfirmationStoreDependencies {
  now?: () => number;
  createNonce?: () => string;
}

export function createComposerConfirmationStore(
  dependencies: ComposerConfirmationStoreDependencies = {},
): ComposerConfirmationStore {
  const entries = new Map<string, ComposerConfirmationEntry>();
  const now = dependencies.now ?? Date.now;
  const createNonce = dependencies.createNonce
    ?? (() => randomBytes(24).toString('base64url'));

  function pruneExpired(): void {
    const currentTime = now();
    for (const [nonce, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(nonce);
    }
  }

  return {
    issue({ target, argv, policy, display }) {
      if (policy.safety === 'destructive' && !policy.typedConfirmation) {
        throw new Error(
          `Destructive composer policy for ${display} must define typedConfirmation.`,
        );
      }
      pruneExpired();
      const nonce = createNonce();
      entries.set(nonce, {
        targetKind: target.kind,
        targetId: target.id,
        argv: [...argv],
        safety: policy.safety,
        typedText: policy.typedConfirmation,
        expiresAt: now() + COMPOSER_CONFIRMATION_TTL_MS,
      });
      return {
        kind: 'confirmation',
        status: 'confirmation_required',
        nonce,
        consequence: policy.confirmationText
          ?? `Running ${display} requires confirmation before Overdeck continues.`,
        ...(policy.typedConfirmation
          ? { typedText: policy.typedConfirmation }
          : {}),
      };
    },

    consume({ target, argv, policy, confirmation }) {
      if (typeof confirmation.nonce !== 'string') {
        throw new ComposerCommandConfirmationError(
          'A valid confirmation nonce is required before this command can run.',
        );
      }

      const entry = entries.get(confirmation.nonce);
      entries.delete(confirmation.nonce);
      if (!entry) {
        throw new ComposerCommandConfirmationError(
          'This command confirmation is missing, invalid, or has already been used. Request a new confirmation and try again.',
        );
      }
      if (entry.expiresAt <= now()) {
        throw new ComposerCommandConfirmationError(
          'This command confirmation has expired. Request a new confirmation and try again.',
        );
      }
      if (
        entry.targetKind !== target.kind ||
        entry.targetId !== target.id ||
        entry.safety !== policy.safety ||
        !sameArgv(entry.argv, argv)
      ) {
        throw new ComposerCommandConfirmationError(
          'This command confirmation does not match the current target or command. Request a new confirmation and try again.',
        );
      }
      if (
        policy.safety === 'destructive' &&
        (typeof confirmation.typedText !== 'string' || confirmation.typedText !== entry.typedText)
      ) {
        throw new ComposerCommandConfirmationError(
          `Type "${entry.typedText ?? ''}" exactly to confirm this destructive command.`,
        );
      }
    },
  };
}

function sameArgv(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const composerConfirmationStore = createComposerConfirmationStore();
