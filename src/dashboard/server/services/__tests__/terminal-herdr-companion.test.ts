/**
 * PAN-5122 FR-5: a companion carries no `agentId` token, so `/ws/terminal`
 * must resolve it by its own `companion` token when no agent answers to the
 * session name.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveHerdrTerminalId, type ResolveHerdrTerminalIdDeps } from '../terminal-service.js';

function deps(overrides: Partial<ResolveHerdrTerminalIdDeps> = {}): ResolveHerdrTerminalIdDeps {
  return {
    backendName: vi.fn(async () => 'herdr'),
    findAgent: vi.fn(async () => null),
    findCompanion: vi.fn(async () => null),
    ...overrides,
  };
}

describe('resolveHerdrTerminalId companion resolution', () => {
  it("resolves a Herdr companion by its own token when no agent has the name", async () => {
    const d = deps({ findCompanion: vi.fn(async () => 't-9') });
    await expect(resolveHerdrTerminalId('companion-conv-x', d)).resolves.toBe('t-9');
    expect(d.findCompanion).toHaveBeenCalledWith('companion-conv-x');
  });

  it('never asks the companion lookup for a non-companion name', async () => {
    const d = deps();
    await expect(resolveHerdrTerminalId('conv-x', d)).resolves.toBeNull();
    expect(d.findCompanion).not.toHaveBeenCalled();
  });

  it('returns null on a tmux host without asking Herdr', async () => {
    const d = deps({ backendName: vi.fn(async () => 'tmux') });
    await expect(resolveHerdrTerminalId('companion-conv-x', d)).resolves.toBeNull();
    expect(d.findAgent).not.toHaveBeenCalled();
    expect(d.findCompanion).not.toHaveBeenCalled();
  });
});
