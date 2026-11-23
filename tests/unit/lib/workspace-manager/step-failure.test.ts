import { describe, expect, it } from 'vitest';
import { failingStepLines, setupStepError } from '../../../../src/lib/workspace-manager/step-failure.js';

describe('failingStepLines (PAN-5489)', () => {
  it('picks the Hume key-not-found line', () => {
    const line = '[hume] API key not found: HUME_API_KEY is not set in the process environment, /h/.overdeck.env';
    expect(failingStepLines([line])).toBe(line);
  });

  it('picks only the failed lines when success lines surround them', () => {
    const steps = [
      '[tunnel] Read Cloudflare credentials',
      '[tunnel] Failed to get tunnel config: x',
      '[tunnel] Added ingress rule',
      '[tunnel] Failed to create DNS record: y',
      '[tunnel] Done',
    ];
    expect(failingStepLines(steps)).toBe('[tunnel] Failed to get tunnel config: x; [tunnel] Failed to create DNS record: y');
  });

  it('falls back to the last line when no line says failed or not found', () => {
    expect(failingStepLines(['[hume] Target config: a', '[hume] BYOLLM URL: b'])).toBe('[hume] BYOLLM URL: b');
  });

  it('returns an empty string for no lines', () => {
    expect(failingStepLines([])).toBe('');
  });
});

describe('setupStepError (PAN-5489)', () => {
  it('puts the failing step line after the label', () => {
    const line = '[hume] API key not found: HUME_API_KEY is not set in the process environment';
    expect(setupStepError('Hume EVI config setup', [line])).toBe(`Hume EVI config setup failed: ${line}`);
  });

  it('returns only the label when there are no step lines', () => {
    expect(setupStepError('Tunnel setup', [])).toBe('Tunnel setup failed');
  });
});
