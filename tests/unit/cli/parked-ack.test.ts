/** Fixture tests for `pan parked ack` (PAN-3485 follow-up). */
import { describe, expect, it, vi } from 'vitest';
import { runParkedAck } from '../../../src/cli/commands/parked.js';
import type { ParkedRow } from '../../../src/lib/parked/resolver.js';

const NOW = Date.parse('2026-08-02T14:00:00.000Z');
const DAY = 86_400_000;

function row(issueId: string, orbit: string, ageDays: number): ParkedRow {
  return {
    issueId,
    orbit: orbit as ParkedRow['orbit'],
    parkedAt: new Date(NOW - ageDays * DAY).toISOString(),
    parkReason: `parked ${issueId}`,
    unparkCondition: 'release',
  };
}

describe('runParkedAck', () => {
  it('acks only the requested orbit, oldest-included, and prints the flywheel hand-off', async () => {
    const acked: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const rows = [row('PAN-1', 'needs-you', 6), row('PAN-2', 'operator-gate', 6), row('MIN-9', 'needs-you', 1)];
    const result = await runParkedAck({}, {
      now: NOW,
      resolveRows: async () => rows,
      ackIssueTrips: async (issueId) => { acked.push(issueId); return 1; },
    });
    expect(acked).toEqual(['PAN-1', 'MIN-9']);
    expect(result.map((r) => r.issueId)).toEqual(['PAN-1', 'MIN-9']);
    expect(log.mock.calls.some((call) => String(call[0]).includes('pan tell flywheel-orchestrator'))).toBe(true);
    log.mockRestore();
  });

  it('--older-than filters out younger rows', async () => {
    const acked: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rows = [row('PAN-1', 'needs-you', 6), row('MIN-9', 'needs-you', 1)];
    const result = await runParkedAck({ olderThan: '3' }, {
      now: NOW,
      resolveRows: async () => rows,
      ackIssueTrips: async (issueId) => { acked.push(issueId); return 1; },
    });
    expect(acked).toEqual(['PAN-1']);
    expect(result).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('--dry-run writes nothing and skips the hand-off', async () => {
    const acked: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runParkedAck({ dryRun: true }, {
      now: NOW,
      resolveRows: async () => [row('PAN-1', 'needs-you', 6)],
      ackIssueTrips: async (issueId) => { acked.push(issueId); return 1; },
    });
    expect(acked).toHaveLength(0);
    expect(log.mock.calls.some((call) => String(call[0]).includes('pan tell'))).toBe(false);
    log.mockRestore();
  });

  it('rejects a malformed --older-than', async () => {
    await expect(runParkedAck({ olderThan: 'banana' }, { now: NOW, resolveRows: async () => [] })).rejects.toThrow('--older-than');
  });

  it('an empty orbit answer is a clean no-op', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runParkedAck({ orbit: 'conflicts' }, { now: NOW, resolveRows: async () => [] });
    expect(result).toHaveLength(0);
    expect(log.mock.calls.some((call) => String(call[0]).includes('Nothing to acknowledge'))).toBe(true);
    log.mockRestore();
  });
});
