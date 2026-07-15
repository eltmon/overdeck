import { describe, expect, it } from 'vitest';
import { closeOutErrorMessage } from './CloseOutIssueButton';

describe('CloseOutIssueButton gate errors', () => {
  it('renders each unaccepted miss with its row number, title, and observed state', () => {
    expect(closeOutErrorMessage({
      error: 'Definition-of-Done gate blocked close-out',
      dodGate: {
        rows: [
          { num: 7, title: 'Deployed', observed: 'server build is stale', status: 'miss' },
          { num: 6, title: 'Verified on main', observed: 'accepted', status: 'miss', acceptedBy: {} },
        ],
      },
    })).toBe('Definition-of-Done gate blocked close-out\n7 Deployed: server build is stale');
  });
});
