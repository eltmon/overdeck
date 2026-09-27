import { describe, expect, it } from 'vitest';
import { reconcileComposerEchoes } from '../composerEchoes';
import type { ChatMessage, FailedMessage, SubagentSummary } from '../../components/chat/chat-types';

function optimisticMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'optimistic-1',
    role: 'user',
    text: 'please pause and check the logs',
    createdAt: '2026-09-27T10:00:00.000Z',
    acknowledged: true,
    deliveryState: 'accepted',
    ...overrides,
  };
}

function subagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    agentId: 'agent-1',
    agentType: 'general-purpose',
    description: 'Investigate flaky test',
    toolUseId: 'toolu_1',
    spawnDepth: 1,
    status: 'running',
    background: true,
    ...overrides,
  };
}

function makeState(optimistic: ChatMessage[], failed: FailedMessage[] = [], consumedEchoIds: string[] = []) {
  return { optimistic, failed, consumedEchoIds };
}

describe('reconcileComposerEchoes subagent matching (PAN-4247)', () => {
  it('labels an accepted bubble delivered to a subagent when a later human input contains its text behind an @path prefix line (AC1)', () => {
    const local = optimisticMessage();
    const sub = subagent({
      humanInputs: [
        { id: 'sc-1', text: '@src/lib/foo.ts\nplease pause and check the logs', createdAt: '2026-09-27T10:00:05.000Z' },
      ],
    });

    const result = reconcileComposerEchoes(makeState([local]), [], [sub]);

    expect(result.optimistic).toEqual([{
      ...local,
      acknowledged: true,
      deliveryState: 'subagent',
      deliveredToSubagent: { agentId: 'agent-1', description: 'Investigate flaky test' },
    }]);
    expect(result.consumedEchoIds).toContain('sc-1');
  });

  it('leaves the bubble unchanged when the matching human input was created before it (AC2)', () => {
    const local = optimisticMessage({ createdAt: '2026-09-27T10:00:10.000Z' });
    const sub = subagent({
      humanInputs: [
        { id: 'sc-1', text: 'please pause and check the logs', createdAt: '2026-09-27T10:00:00.000Z' },
      ],
    });
    const input = makeState([local]);

    const result = reconcileComposerEchoes(input, [], [sub]);

    expect(result).toBe(input);
    expect(result.optimistic).toEqual([local]);
  });

  it('does not re-match a human input id already consumed by an earlier reconciliation', () => {
    const local = optimisticMessage();
    const sub = subagent({
      humanInputs: [
        { id: 'sc-1', text: 'please pause and check the logs', createdAt: '2026-09-27T10:00:05.000Z' },
      ],
    });
    const alreadyConsumed = makeState([local], [], ['sc-1']);

    const result = reconcileComposerEchoes(alreadyConsumed, [], [sub]);

    expect(result).toBe(alreadyConsumed);
    expect(result.optimistic[0]?.deliveryState).toBe('accepted');
  });

  it('leaves an entry already labeled subagent alone so a later main-transcript echo can still claim it', () => {
    const local = optimisticMessage({
      deliveryState: 'subagent',
      deliveredToSubagent: { agentId: 'agent-1', description: 'Investigate flaky test' },
    });
    const sub = subagent({
      humanInputs: [
        { id: 'sc-1', text: 'please pause and check the logs', createdAt: '2026-09-27T10:00:05.000Z' },
      ],
    });

    const result = reconcileComposerEchoes(makeState([local]), [], [sub]);

    // Not re-matched against the subagent pass (already labeled), but a real
    // main-transcript echo for the same text still clears it via the first pass.
    expect(result.optimistic).toEqual([local]);
    const clearedByMain = reconcileComposerEchoes(makeState([local]), [
      { id: 'main-1', role: 'user', text: local.text, createdAt: '2026-09-27T10:00:10.000Z' },
    ]);
    expect(clearedByMain.optimistic).toEqual([]);
  });
});
