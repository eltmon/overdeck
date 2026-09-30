import { describe, expect, it } from 'vitest';
import { formatMemoryDoctorLines } from '../../../src/cli/commands/memory.js';
import type { MemoryDoctorResult } from '../../../src/lib/memory/cli.js';
import type { MemoryHealthSnapshot } from '../../../src/lib/memory/health.js';

function baseResult(health: MemoryHealthSnapshot): MemoryDoctorResult {
  return {
    exitCode: 0,
    provider: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', fallbackChain: [], source: 'default' },
    rollupPendingThreshold: 20,
    issues: [
      {
        projectId: 'overdeck',
        issueId: 'PAN-4370',
        health,
        pendingCount: 3,
        lastObservation: null,
      },
    ],
    staleActiveAgents: [],
  };
}

// PAN-4370 WI-6: pan memory doctor surfaces failure counts and cause from
// health.json so the operator does not have to open the file themselves.
describe('formatMemoryDoctorLines', () => {
  it('appends failures=<reason>:<n> and a cause line for a failing row with a detail (ac1)', () => {
    const health: MemoryHealthSnapshot = {
      status: 'failing',
      last_success: null,
      last_failure: '2026-09-29T00:00:00.000Z',
      last_failure_detail: 'anthropic/claude-haiku-4-5: no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
      last_failure_reason: 'provider-auth-failed',
      extractions_attempted: 3,
      extractions_succeeded: 0,
      failed_by_reason: { 'provider-auth-failed': 3 },
    };

    const lines = formatMemoryDoctorLines(baseResult(health));

    expect(lines.some((line) => line.includes('failures=provider-auth-failed:3'))).toBe(true);
    expect(lines.some((line) => line.includes('cause: provider-auth-failed — anthropic/claude-haiku-4-5'))).toBe(true);
  });

  it('produces no cause line and keeps the existing health/pending/last_success text for a healthy row (ac2)', () => {
    const health: MemoryHealthSnapshot = {
      status: 'healthy',
      last_success: '2026-09-29T00:00:00.000Z',
      last_failure: null,
      last_failure_detail: null,
      last_failure_reason: null,
      extractions_attempted: 5,
      extractions_succeeded: 5,
      failed_by_reason: {},
    };

    const lines = formatMemoryDoctorLines(baseResult(health));

    expect(lines.some((line) => line.includes('cause:'))).toBe(false);
    expect(lines.some((line) => line.includes('PAN-4370: health=healthy pending=3 last_success=2026-09-29T00:00:00.000Z'))).toBe(true);
  });
});
