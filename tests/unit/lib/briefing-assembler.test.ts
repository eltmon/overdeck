import { describe, it, expect } from 'vitest';
import { assembleLiveBriefingMarkdown } from '../../../src/lib/briefing-assembler.js';
import type { DashboardSnapshot } from '@overdeck/contracts';

describe('assembleLiveBriefingMarkdown', () => {
  it('filters troubled agents on troubled gate alone — counts only troubled=true agents', async () => {
    const snapshot: DashboardSnapshot = {
      sequence: 1,
      agents: [
        {
          id: 'agent-1',
          issueId: 'PAN-1',
          status: 'stopped',
          troubled: true,
        },
        {
          id: 'agent-2',
          issueId: 'PAN-2',
          status: 'stopped',
          consecutiveFailures: 1,
          troubled: undefined,
        },
        {
          id: 'agent-3',
          issueId: 'PAN-3',
          status: 'stopped',
          consecutiveFailures: 2,
          troubled: undefined,
        },
        {
          id: 'agent-4',
          issueId: 'PAN-4',
          status: 'stopped',
          consecutiveFailures: 3,
          troubled: undefined,
        },
      ],
      specialists: [],
      reviewStatuses: [],
      issues: [],
      timestamp: new Date().toISOString(),
    } as DashboardSnapshot;

    const output = await assembleLiveBriefingMarkdown({ snapshot });
    expect(output).toContain('- Troubled agents: 1');
  });

  it('shows zero troubled agents when none have troubled=true', async () => {
    const snapshot: DashboardSnapshot = {
      sequence: 1,
      agents: [
        {
          id: 'agent-1',
          issueId: 'PAN-1',
          status: 'stopped',
          consecutiveFailures: 1,
          troubled: undefined,
        },
        {
          id: 'agent-2',
          issueId: 'PAN-2',
          status: 'stopped',
          consecutiveFailures: 2,
          troubled: undefined,
        },
        {
          id: 'agent-3',
          issueId: 'PAN-3',
          status: 'stopped',
          consecutiveFailures: 3,
          troubled: undefined,
        },
      ],
      specialists: [],
      reviewStatuses: [],
      issues: [],
      timestamp: new Date().toISOString(),
    } as DashboardSnapshot;

    const output = await assembleLiveBriefingMarkdown({ snapshot });
    expect(output).toContain('- Troubled agents: 0');
  });
});
