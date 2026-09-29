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

describe('reconcileComposerEchoes joined-message matching (PAN-4247)', () => {
  it('clears both bubbles and consumes the message id when two quick sends were joined with no separator (AC1)', () => {
    const first = optimisticMessage({
      id: 'optimistic-1',
      text: 'Ah ok that was it',
      createdAt: '2026-09-27T10:00:00.000Z',
    });
    const second = optimisticMessage({
      id: 'optimistic-2',
      text: 'I was sending to a subagent wasnt I?',
      createdAt: '2026-09-27T10:00:01.000Z',
    });
    const joined: ChatMessage = {
      id: 'main-joined',
      role: 'user',
      text: 'Ah ok that was itI was sending to a subagent wasnt I?',
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([first, second]), [joined]);

    expect(result.optimistic).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-joined');
  });

  it('leaves the state unchanged when the message matches no contiguous concatenation of pending bubbles (AC2)', () => {
    const first = optimisticMessage({ id: 'optimistic-1', text: 'first message', createdAt: '2026-09-27T10:00:00.000Z' });
    const second = optimisticMessage({ id: 'optimistic-2', text: 'second message', createdAt: '2026-09-27T10:00:01.000Z' });
    const unrelated: ChatMessage = {
      id: 'main-unrelated',
      role: 'user',
      text: 'totally unrelated text',
      createdAt: '2026-09-27T10:00:05.000Z',
    };
    const input = makeState([first, second]);

    const result = reconcileComposerEchoes(input, [unrelated]);

    expect(result).toBe(input);
    expect(result.optimistic).toEqual([first, second]);
  });

  it('joins with a newline or space separator, and only consumes entries and the message once', () => {
    const first = optimisticMessage({ id: 'optimistic-1', text: 'part one', createdAt: '2026-09-27T10:00:00.000Z' });
    const second = optimisticMessage({ id: 'optimistic-2', text: 'part two', createdAt: '2026-09-27T10:00:01.000Z' });
    const joinedWithSpace: ChatMessage = {
      id: 'main-joined-space',
      role: 'user',
      text: 'part one part two',
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([first, second]), [joinedWithSpace]);

    expect(result.optimistic).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.consumedEchoIds).toEqual(expect.arrayContaining(['main-joined-space']));
  });
});

describe('reconcileComposerEchoes pasted and merged prompts (PAN-4305)', () => {
  const LANDED_WRAPPED_INNER = 'Sonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.';
  const TWO_IMAGE_COMPOSER_TEXT = '@/tmp/att/bee4.png\n@/tmp/att/55f6.png\nWhat just happned here?';
  const QUEUED_MERGED = '@/tmp/att/bee4.png @/tmp/att/55f6.png\nWhat just happned here?';
  const ONE_IMAGE_COMPOSER_TEXT = '@/tmp/att/55f6.png\nWhat just happned here?';

  it('1. clears a bubble whose text equals the unwrapped pasted_content inner text', () => {
    const local = optimisticMessage({ text: LANDED_WRAPPED_INNER, createdAt: '2026-09-27T10:00:00.000Z' });
    const echo: ChatMessage = {
      id: 'main-1',
      role: 'user',
      text: LANDED_WRAPPED_INNER,
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([local]), [echo]);

    expect(result.optimistic).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-1');
  });

  it('2. clears the two-image composer bubble against the space-joined merged record (whitespace collapse)', () => {
    const local = optimisticMessage({ text: TWO_IMAGE_COMPOSER_TEXT, createdAt: '2026-09-27T10:00:00.000Z' });
    const echo: ChatMessage = {
      id: 'main-merged',
      role: 'user',
      text: QUEUED_MERGED,
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([local]), [echo]);

    expect(result.optimistic).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-merged');
  });

  it('3. clears the one-image bubble contained in the merged record via containment, consuming its id', () => {
    const local = optimisticMessage({ text: ONE_IMAGE_COMPOSER_TEXT, createdAt: '2026-09-27T10:00:00.000Z' });
    const echo: ChatMessage = {
      id: 'main-merged',
      role: 'user',
      text: QUEUED_MERGED,
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([local]), [echo]);

    expect(result.optimistic).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-merged');
  });

  it('4. clears two leftover bubbles both contained in one record', () => {
    const first = optimisticMessage({ id: 'optimistic-1', text: 'partial one', createdAt: '2026-09-27T10:00:00.000Z' });
    const second = optimisticMessage({ id: 'optimistic-2', text: 'partial two', createdAt: '2026-09-27T10:00:01.000Z' });
    const containing: ChatMessage = {
      id: 'main-containing',
      role: 'user',
      text: 'partial one and also partial two',
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([first, second]), [containing]);

    expect(result.optimistic).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-containing');
  });

  it('5. returns the identical state object for a truly missing bubble', () => {
    const local = optimisticMessage({ text: 'never landed anywhere', createdAt: '2026-09-27T10:00:00.000Z' });
    const unrelated: ChatMessage = {
      id: 'main-unrelated',
      role: 'user',
      text: 'completely different text',
      createdAt: '2026-09-27T10:00:05.000Z',
    };
    const input = makeState([local]);

    const result = reconcileComposerEchoes(input, [unrelated]);

    expect(result).toBe(input);
  });

  it('6. removes a failed notFoundInTranscript entry whose text is contained in a later record', () => {
    const failedEntry: FailedMessage = {
      id: 'failed-1',
      text: ONE_IMAGE_COMPOSER_TEXT,
      createdAt: '2026-09-27T10:00:00.000Z',
      kind: 'prompt',
      notFoundInTranscript: true,
    };
    const echo: ChatMessage = {
      id: 'main-merged',
      role: 'user',
      text: QUEUED_MERGED,
      createdAt: '2026-09-27T10:00:05.000Z',
    };

    const result = reconcileComposerEchoes(makeState([], [failedEntry]), [echo]);

    expect(result.failed).toEqual([]);
    expect(result.consumedEchoIds).toContain('main-merged');
  });

  it('7. does not clear a bubble when the containing record was created before it', () => {
    const local = optimisticMessage({ text: ONE_IMAGE_COMPOSER_TEXT, createdAt: '2026-09-27T10:00:10.000Z' });
    const earlierContaining: ChatMessage = {
      id: 'main-earlier',
      role: 'user',
      text: QUEUED_MERGED,
      createdAt: '2026-09-27T10:00:00.000Z',
    };
    const input = makeState([local]);

    const result = reconcileComposerEchoes(input, [earlierContaining]);

    expect(result).toBe(input);
    expect(result.optimistic).toEqual([local]);
  });
});
