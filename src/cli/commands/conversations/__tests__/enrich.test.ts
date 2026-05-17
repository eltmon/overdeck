/**
 * Regression tests for `pan conversations enrich` (PAN-457).
 *
 * enrichSessions makes real AI calls so we mock the enrichment module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

// ─── Mock enrichment module ───────────────────────────────────────────────────

class MockCostThresholdError extends Error {
  constructor(
    public readonly estimatedCost: number,
    public readonly threshold: number,
    public readonly sessionCount: number,
  ) {
    super('Cost threshold exceeded');
    this.name = 'CostThresholdError';
  }
}

const mockEnrichSessions = vi.fn();

vi.mock('../../../../lib/conversations/enrichment/index.js', () => ({
  enrichSessions: (...args: unknown[]) => mockEnrichSessions(...args),
  CostThresholdError: MockCostThresholdError,
  estimateEnrichmentCost: vi.fn().mockReturnValue(0.01),
}));

// ─── Test setup ───────────────────────────────────────────────────────────────

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `enrich-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
  mockEnrichSessions.mockReset();
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('enrichAction', () => {
  it('exits 1 for invalid tier', async () => {
    const { enrichAction } = await import('../enrich.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(enrichAction([], { tier: '4' })).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on CostThresholdError without --yes', async () => {
    mockEnrichSessions.mockRejectedValue(new MockCostThresholdError(5.00, 1.00, 50));

    const { enrichAction } = await import('../enrich.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(enrichAction([], { tier: '1' })).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('retries with force: true on CostThresholdError when --yes provided', async () => {
    mockEnrichSessions
      .mockRejectedValueOnce(new MockCostThresholdError(5.00, 1.00, 50))
      .mockResolvedValueOnce({ enriched: 50, skipped: 0, errors: 0, durationMs: 100 });

    const { enrichAction } = await import('../enrich.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await enrichAction([], { tier: '1', yes: true });

    // First call throws, second call with force: true succeeds
    expect(mockEnrichSessions).toHaveBeenCalledTimes(2);
    const secondCall = mockEnrichSessions.mock.calls[1][0];
    expect(secondCall.force).toBe(true);
  });

  it.each([
    [{ deep: true }, 3, true],
    [{ upgrade: true }, 1, false],
    [{ deep: true, upgrade: true }, 2, false],
  ])('maps enrichment flags %o to tier L%s', async (opts, expectedTier, expectedSkip) => {
    mockEnrichSessions.mockResolvedValue({ enriched: 1, skipped: 0, errors: 0, durationMs: 100 });

    const { enrichAction } = await import('../enrich.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await enrichAction([], opts);

    expect(mockEnrichSessions).toHaveBeenCalledWith(expect.objectContaining({
      tier: expectedTier,
      skipAlreadyEnriched: expectedSkip,
    }));
  });

  it('--with plus --full requests L3 full-transcript enrichment for explicit sessions', async () => {
    mockEnrichSessions.mockResolvedValue({ enriched: 1, skipped: 0, errors: 0, durationMs: 100 });

    const { enrichAction } = await import('../enrich.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await enrichAction(['42'], { full: true, with: 'claude-opus-4-7', yes: true });

    expect(mockEnrichSessions).toHaveBeenCalledWith(expect.objectContaining({
      tier: 3,
      sessionIds: [42],
      modelOverride: 'claude-opus-4-7',
      skipAlreadyEnriched: false,
    }));
  });

  it('happy path: shows enrichment summary', async () => {
    mockEnrichSessions.mockResolvedValue({ enriched: 5, skipped: 2, errors: 0, durationMs: 200 });

    const { enrichAction } = await import('../enrich.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await enrichAction([], { tier: '1' });

    const output = logs.join('\n');
    expect(output).toContain('5');
    expect(output).toContain('2');
  });

  it('shows error count when enrichment has errors', async () => {
    mockEnrichSessions.mockResolvedValue({ enriched: 3, skipped: 0, errors: 2, durationMs: 150 });

    const { enrichAction } = await import('../enrich.js');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));

    await enrichAction([], { tier: '2' });

    const output = logs.join('\n');
    expect(output).toContain('2');
  });
});
