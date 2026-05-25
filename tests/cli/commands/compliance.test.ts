import { describe, expect, it } from 'vitest';

import { formatComplianceStatus } from '../../../src/cli/commands/compliance.js';
import type { ComplianceStatusResult } from '../../../src/lib/compliance/status.js';

function status(overrides: Partial<ComplianceStatusResult> = {}): ComplianceStatusResult {
  return {
    mode: 'advisory',
    recentMissCount: 0,
    since: '2026-05-24T12:00:00.000Z',
    projectId: 'panopticon-cli',
    workspaceId: null,
    issueId: null,
    sessionId: null,
    ...overrides,
  };
}

describe('compliance command formatting', () => {
  it('shows the advisory default with zero recent misses', () => {
    const output = formatComplianceStatus(status()).join('\n');

    expect(output).toContain('Compliance mode: advisory');
    expect(output).toContain('Recent compliance.miss observations: 0');
  });

  it('shows off mode and nonzero miss counts with active filters', () => {
    const output = formatComplianceStatus(status({
      mode: 'off',
      recentMissCount: 3,
      workspaceId: 'feature-pan-1204',
      issueId: 'PAN-1204',
      sessionId: 'session-1',
    })).join('\n');

    expect(output).toContain('Compliance mode: off');
    expect(output).toContain('Recent compliance.miss observations: 3');
    expect(output).toContain('Workspace: feature-pan-1204');
    expect(output).toContain('Issue: PAN-1204');
    expect(output).toContain('Session: session-1');
  });
});
