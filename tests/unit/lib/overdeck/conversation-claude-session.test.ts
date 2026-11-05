/** PAN-2652 W2: resolveConversationClaudeSessionId precedence (D3). */
import { describe, expect, it, vi } from 'vitest';

import { resolveConversationClaudeSessionId } from '../../../../src/lib/overdeck/conversation-claude-session.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

function conv(overrides: Partial<{ name: string; claudeSessionId: string | null; clearedToConvId: number | null }>) {
  return {
    name: 'conv-a',
    tmuxSession: 'conv-a',
    claudeSessionId: B,
    clearedToConvId: null,
    ...overrides,
  };
}

describe('resolveConversationClaudeSessionId (PAN-2652 W2)', () => {
  it('ac1: a human chain head prefers its current locator over the launcher pin', async () => {
    const readPin = vi.fn(async () => A);
    await expect(resolveConversationClaudeSessionId(conv({ claudeSessionId: B }), readPin)).resolves.toBe(B);
  });

  it('ac2: a human chain head with no locator falls back to the launcher pin', async () => {
    const readPin = vi.fn(async () => A);
    await expect(resolveConversationClaudeSessionId(conv({ claudeSessionId: null }), readPin)).resolves.toBe(A);
  });

  it('ac3: a superseded /clear row reads its own locator and never the shared launcher', async () => {
    const readPin = vi.fn(async () => C);
    await expect(
      resolveConversationClaudeSessionId(conv({ claudeSessionId: A, clearedToConvId: 7 }), readPin),
    ).resolves.toBe(A);
    expect(readPin).not.toHaveBeenCalled();
  });

  it('ac4: an agent conversation keeps the launcher pin first', async () => {
    const readPin = vi.fn(async () => A);
    await expect(
      resolveConversationClaudeSessionId(conv({ name: 'agent-pan-1', claudeSessionId: B }), readPin),
    ).resolves.toBe(A);
  });
});
