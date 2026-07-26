import { describe, expect, it } from 'vitest';

import { formatIssueRef } from '../issueLabel';

describe('formatIssueRef', () => {
  it('joins a trimmed issue identifier and title with an em dash', () => {
    expect(formatIssueRef(' PAN-1 ', ' Fix widget ')).toBe('PAN-1 — Fix widget');
  });

  it.each([null, undefined, '', '   '])(
    'returns the issue identifier when the title is %s',
    (title) => {
      expect(formatIssueRef('PAN-1', title)).toBe('PAN-1');
    },
  );

  it.each([null, undefined, '', '   '])(
    'returns null when the issue identifier is %s',
    (issueId) => {
      expect(formatIssueRef(issueId, 'Fix widget')).toBeNull();
    },
  );
});
