import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { bareKimiModel, parseKimiSession } from '../kimi-parser.js';
import { getPricing } from '../../cost.js';

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

describe('K3.1 Pro pricing rows', () => {
  it('prices the coding-endpoint and platform ids at $2/M input, $10/M output', () => {
    expect(getPricing('custom', bareKimiModel('kimi-code/k3.1-pro'))!.inputPer1k * 1000).toBe(2);
    expect(getPricing('custom', 'kimi-k3.1-pro')!.inputPer1k).toBe(0.002);
  });

  it('prices Highspeed at double the input/output rate', () => {
    expect(getPricing('custom', 'k3.1-pro-highspeed')!.outputPer1k).toBe(0.02);
  });

  it('leaves K3 pricing unchanged', () => {
    expect(getPricing('custom', 'k3')!.inputPer1k).toBe(0.003);
  });
});

describe('parseKimiSession (PAN-1837 wi8b, against the pinned wi-fixture)', () => {
  it('ac1: produces a non-empty normalized summary whose turn count matches the fixture (2 turns)', () => {
    const usage = parseKimiSession(FIXTURE_PATH);

    expect(usage).not.toBeNull();
    expect(usage?.messageCount).toBe(2);
  });

  it('ac2: returns token usage with non-zero cache-read accounting, summed across every usage.record', () => {
    const usage = parseKimiSession(FIXTURE_PATH);

    expect(usage?.usage).toEqual({
      inputTokens: 10788,
      outputTokens: 188,
      cacheReadTokens: 106240,
      cacheWriteTokens: 0,
    });
  });

  it('ac3: computes a non-zero session cost using the k3 custom-provider pricing row', () => {
    const usage = parseKimiSession(FIXTURE_PATH);
    const pricing = getPricing('custom', 'k3');

    expect(pricing).not.toBeNull();
    const expectedCost = (10788 / 1000) * pricing!.inputPer1k
      + (188 / 1000) * pricing!.outputPer1k
      + (106240 / 1000) * (pricing!.cacheReadPer1k ?? 0);

    expect(usage?.cost).toBeGreaterThan(0);
    expect(usage?.cost).toBeCloseTo(expectedCost, 10);
    expect(usage?.cost_v2).toBe(usage?.cost);
  });

  it('resolves the bare model id and session id from the fixture path shape', () => {
    const usage = parseKimiSession(FIXTURE_PATH);

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

    const usage = parseKimiSession(nestedFixture);

    expect(usage?.sessionId).toBe('session_1fc830f7-151f-477c-ae4a-571dfee57723');
  });

  it('returns null for a missing or unreadable file', () => {
    expect(parseKimiSession('/tmp/does-not-exist-kimi-wire.jsonl')).toBeNull();
  });

  it('returns null when the file has no usage.record entries', () => {
    // Any real fixture line set without usage.record — the metadata-only prefix.
    expect(parseKimiSession(join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'kimi', 'README.md'))).toBeNull();
  });
});
