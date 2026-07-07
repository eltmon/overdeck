import { describe, expect, it } from 'vitest';

import { extractCostEvents, resolveUnmappedSessionIssueId } from '../reconciler.js';
import type { ConversationSessionLookup } from '../attribution.js';

describe('reconciler no-issue buckets', () => {
  const sessionId = 'session-cost-bucket';

  function claudeAssistantLine(requestId: string): string {
    return JSON.stringify({
      type: 'assistant',
      requestId,
      timestamp: '2026-07-06T00:00:00.000Z',
      message: {
        model: 'claude-haiku-4-5',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });
  }

  it.each([
    [{ name: 'launch-video' }, 'CONVERSATIONS'],
    [{ name: 'flywheel-orchestrator' }, 'FLYWHEEL'],
    [null, 'UNATTRIBUTED'],
  ] as const)('feeds unmapped sessions into %s bucket', (conversation, expectedIssueId) => {
    const lookup: ConversationSessionLookup = () => conversation;
    const issueId = resolveUnmappedSessionIssueId({ sessionId }, lookup);
    const events = extractCostEvents(claudeAssistantLine(`req-${expectedIssueId}`), 'unattributed', issueId, 'implementation', sessionId);

    expect(events).toHaveLength(1);
    expect(events[0]!.issueId).toBe(expectedIssueId);
  });

  it('preserves an already-resolved issue id passed into the extractor', () => {
    const events = extractCostEvents(claudeAssistantLine('req-pan'), 'agent-pan-2387', 'PAN-2387', 'work', sessionId);

    expect(events).toHaveLength(1);
    expect(events[0]!.issueId).toBe('PAN-2387');
  });
});
