import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn };
});

import { COMPOSER_COMMAND_MANIFEST, getHarnessBehavior } from '@overdeck/contracts';
import { resolvePolicy } from '../../../../lib/composer-commands/policy.js';
import {
  COMMANDS_API_HARNESSES,
  getCommandsPayload,
  resolveCommandsRequest,
} from '../commands.js';

describe('GET /api/commands payload', () => {
  it('projects every manifest entry with its resolved execution policy', () => {
    const payload = getCommandsPayload('claude-code');

    expect(payload.overdeck).toHaveLength(COMPOSER_COMMAND_MANIFEST.length);
    for (const entry of COMPOSER_COMMAND_MANIFEST) {
      const projected = payload.overdeck.find(candidate => candidate.id === entry.id);
      expect(projected).toEqual({
        ...entry,
        mode: resolvePolicy(entry.path).mode,
        safety: resolvePolicy(entry.path).safety,
      });
    }
  });

  it('returns the requested harness native commands and rejects unknown harnesses', () => {
    expect(getCommandsPayload('claude-code').native)
      .toEqual(getHarnessBehavior('claude-code').nativeCommands);
    expect(getCommandsPayload('codex').native)
      .toEqual(getHarnessBehavior('codex').nativeCommands);

    expect(resolveCommandsRequest('unknown')).toEqual({
      ok: false,
      error: `Unknown harness "unknown". Expected one of: ${COMMANDS_API_HARNESSES.join(', ')}.`,
      accepted: COMMANDS_API_HARNESSES,
    });
  });

  it('serves stable module-state payloads without spawning a process', () => {
    const first = resolveCommandsRequest('claude-code');
    const second = resolveCommandsRequest('claude-code');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.payload).toBe(first.payload);
      expect(JSON.stringify(second.payload)).toBe(JSON.stringify(first.payload));
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
