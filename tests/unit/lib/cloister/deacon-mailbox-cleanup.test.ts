import { describe, expect, it } from 'vitest';
import { hasActionableMailboxItems } from '../../../../src/lib/cloister/agent-mailbox.js';

describe('abandoned feedback mailbox cleanup', () => {
  it('preserves stopped-agent feedback before and after mailbox delivery', () => {
    expect(hasActionableMailboxItems([
      { state: 'pending', actionRequired: true },
    ])).toBe(true);
    expect(hasActionableMailboxItems([
      { state: 'delivered', actionRequired: true },
    ])).toBe(true);
  });

  it('allows cleanup only after feedback is terminal or non-actionable', () => {
    expect(hasActionableMailboxItems([
      { state: 'acknowledged', actionRequired: true },
      { state: 'delivered', actionRequired: false },
    ])).toBe(false);
  });
});
