import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCapturedCommand: vi.fn(async (argv: readonly string[]) => ({
    kind: 'captured' as const,
    status: 'completed' as const,
    command: `/pan ${argv.join(' ')}`,
    output: 'done',
    truncated: false,
  })),
}));

vi.mock('../executors.js', () => ({
  runCapturedCommand: mocks.runCapturedCommand,
}));

import type { ComposerCommandPolicy } from '@overdeck/contracts';
import {
  COMPOSER_CONFIRMATION_TTL_MS,
  ComposerCommandConfirmationError,
  createComposerConfirmationStore,
} from '../confirmations.js';
import { parseOverdeckComposerCommand } from '../parser.js';
import { handleComposerCommand, type ComposerCommandTarget } from '../router.js';

const target: ComposerCommandTarget = {
  kind: 'conversation',
  id: 'test-conversation',
  harness: 'claude-code',
};

const dialogPolicy: ComposerCommandPolicy = {
  mode: 'captured',
  safety: 'dialog',
  confirmationText: 'This command updates the selected conversation. Review the target before continuing.',
};

const destructivePolicy: ComposerCommandPolicy = {
  mode: 'captured',
  safety: 'destructive',
  confirmationText: 'This command permanently removes the selected resource. This action cannot be undone.',
  typedConfirmation: 'DELETE PAN-42',
};

function createStore() {
  let nonce = 0;
  return createComposerConfirmationStore({
    createNonce: () => `nonce-${++nonce}`,
  });
}

function parseStatus() {
  return parseOverdeckComposerCommand('/pan status')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T21:00:00Z'));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('composer command confirmations', () => {
  it('issues a dialog nonce and executes the confirmed command exactly once', async () => {
    const confirmationStore = createStore();
    const dependencies = {
      confirmationStore,
      resolvePolicy: () => dialogPolicy,
    };
    const first = await handleComposerCommand({
      parsed: parseStatus(),
      target,
    }, dependencies);

    expect(first).toEqual({
      kind: 'confirmation',
      status: 'confirmation_required',
      nonce: 'nonce-1',
      consequence: dialogPolicy.confirmationText,
    });
    expect(mocks.runCapturedCommand).not.toHaveBeenCalled();

    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { nonce: 'nonce-1' },
    }, dependencies)).resolves.toMatchObject({
      kind: 'captured',
      status: 'completed',
    });
    expect(mocks.runCapturedCommand).toHaveBeenCalledOnce();

    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { nonce: 'nonce-1' },
    }, dependencies)).rejects.toBeInstanceOf(ComposerCommandConfirmationError);
    expect(mocks.runCapturedCommand).toHaveBeenCalledOnce();
  });

  it('rejects missing, expired, and argv-mismatched confirmations without executing', async () => {
    const confirmationStore = createStore();
    const dependencies = {
      confirmationStore,
      resolvePolicy: () => dialogPolicy,
    };

    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { typedText: 'unused' },
    }, dependencies)).rejects.toThrow('valid confirmation nonce');

    const expiring = await handleComposerCommand({
      parsed: parseStatus(),
      target,
    }, dependencies);
    expect(expiring.kind).toBe('confirmation');
    await vi.advanceTimersByTimeAsync(COMPOSER_CONFIRMATION_TTL_MS + 1);
    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { nonce: 'nonce-1' },
    }, dependencies)).rejects.toThrow('expired');

    const mismatched = await handleComposerCommand({
      parsed: parseStatus(),
      target,
    }, dependencies);
    expect(mismatched.kind).toBe('confirmation');
    await expect(handleComposerCommand({
      parsed: { ...parseStatus(), argv: ['status', 'different'] },
      target,
      confirmation: { nonce: 'nonce-2' },
    }, dependencies)).rejects.toThrow('does not match');
    expect(mocks.runCapturedCommand).not.toHaveBeenCalled();
  });

  it('requires the exact typed text for a synthetic destructive policy', async () => {
    const confirmationStore = createStore();
    // Test-only policy injection exercises the destructive branch without adding
    // a destructive command to production policy discovery.
    const dependencies = {
      confirmationStore,
      resolvePolicy: () => destructivePolicy,
    };
    const first = await handleComposerCommand({
      parsed: parseStatus(),
      target,
    }, dependencies);

    expect(first).toEqual({
      kind: 'confirmation',
      status: 'confirmation_required',
      nonce: 'nonce-1',
      consequence: destructivePolicy.confirmationText,
      typedText: 'DELETE PAN-42',
    });

    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { nonce: 'nonce-1', typedText: 'delete pan-42' },
    }, dependencies)).rejects.toThrow('Type "DELETE PAN-42" exactly');
    expect(mocks.runCapturedCommand).not.toHaveBeenCalled();

    const second = await handleComposerCommand({
      parsed: parseStatus(),
      target,
    }, dependencies);
    expect(second.kind).toBe('confirmation');
    await expect(handleComposerCommand({
      parsed: parseStatus(),
      target,
      confirmation: { nonce: 'nonce-2', typedText: 'DELETE PAN-42' },
    }, dependencies)).resolves.toMatchObject({
      kind: 'captured',
      status: 'completed',
    });
    expect(mocks.runCapturedCommand).toHaveBeenCalledOnce();
  });
});
