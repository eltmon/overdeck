import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { bareKimiModel, parseKimiSessionSync } from '../kimi-parser.js';
import { getPricingSync } from '../../cost.js';

const FIXTURE_PATH = join(
  import.meta.dirname,
  '..', '..', '..', '..',
  'tests', 'fixtures', 'kimi', 'wire.jsonl',
);

describe('bareKimiModel', () => {
  it('strips the kimi-code/ alias prefix', () => {
    expect(bareKimiModel('kimi-code/k3')).toBe('k3');
    expect(bareKimiModel('k3')).toBe('k3');
  });
});

describe('parseKimiSessionSync (PAN-1837 wi8b, against the pinned wi-fixture)', () => {
  it('ac1: produces a non-empty normalized summary whose turn count matches the fixture (2 turns)', () => {
    const usage = parseKimiSessionSync(FIXTURE_PATH);

    expect(usage).not.toBeNull();
    expect(usage?.messageCount).toBe(2);
  });

  it('ac2: returns token usage with non-zero cache-read accounting, summed across every usage.record', () => {
    const usage = parseKimiSessionSync(FIXTURE_PATH);

    expect(usage?.usage).toEqual({
      inputTokens: 10788,
      outputTokens: 188,
      cacheReadTokens: 106240,
      cacheWriteTokens: 0,
    });
  });

  it('ac3: computes a non-zero session cost using the k3 custom-provider pricing row', () => {
    const usage = parseKimiSessionSync(FIXTURE_PATH);
    const pricing = getPricingSync('custom', 'k3');

    expect(pricing).not.toBeNull();
    const expectedCost = (10788 / 1000) * pricing!.inputPer1k
      + (188 / 1000) * pricing!.outputPer1k
      + (106240 / 1000) * (pricing!.cacheReadPer1k ?? 0);

    expect(usage?.cost).toBeGreaterThan(0);
    expect(usage?.cost).toBeCloseTo(expectedCost, 10);
    expect(usage?.cost_v2).toBe(usage?.cost);
  });

  it('resolves the bare model id and session id from the fixture path shape', () => {
    const usage = parseKimiSessionSync(FIXTURE_PATH);

    expect(usage?.model).toBe('k3');
    expect(usage?.sessionFile).toBe(FIXTURE_PATH);
  });

  it('derives the session id from the real sessions/<workDirKey>/<sessionId>/ layout', () => {
    const nestedFixture = join(
      import.meta.dirname,
      '..', '..', '..', '..',
      'tests', 'fixtures', 'kimi', 'sessions',
      'wd_kimi-fixture-scratch_ef33f89ad7cf',
      'session_1fc830f7-151f-477c-ae4a-571dfee57723',
      'agents', 'main', 'wire.jsonl',
    );

    const usage = parseKimiSessionSync(nestedFixture);

    expect(usage?.sessionId).toBe('session_1fc830f7-151f-477c-ae4a-571dfee57723');
  });

  it('returns null for a missing or unreadable file', () => {
    expect(parseKimiSessionSync('/tmp/does-not-exist-kimi-wire.jsonl')).toBeNull();
  });

  it('returns null when the file has no usage.record entries', () => {
    // Any real fixture line set without usage.record — the metadata-only prefix.
    expect(parseKimiSessionSync(join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'kimi', 'README.md'))).toBeNull();
  });
});
