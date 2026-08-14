/**
 * `pan status` restart-gate line (PAN-3729).
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import { formatRestartGateLine } from '../../../src/cli/commands/status.js';

const entry = (requesterId: string) => ({
  requesterId,
  kind: 'deploy',
  reason: 'post-merge deploy for PAN-3729',
  requestedAt: '2026-08-14T00:00:00.000Z',
});

describe('formatRestartGateLine (PAN-3729)', () => {
  it('says nothing when no request is waiting', () => {
    expect(formatRestartGateLine(null)).toBeNull();
    expect(formatRestartGateLine({ status: 'idle', pending: [] })).toBeNull();
  });

  it('counts the waiting requests and names both ways to release them', () => {
    const line = formatRestartGateLine({ status: 'pending', pending: [entry('deploy:PAN-3729:1'), entry('reload:2')] });
    expect(line).toContain('2 restart request(s) waiting for operator approval');
    expect(line).toContain('dashboard banner');
    expect(line).toContain('pan restart approve');
  });
});
