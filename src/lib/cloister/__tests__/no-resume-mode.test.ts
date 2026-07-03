import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_TIME = new Date('2026-05-17T12:00:00.000Z');
const CLOISTER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('no-resume mode', () => {
  let originalNoResume: string | undefined;
  let originalResume: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.resetModules();
    originalNoResume = process.env.OVERDECK_NO_RESUME;
    originalResume = process.env.OVERDECK_RESUME;
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_RESUME;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    if (originalNoResume === undefined) delete process.env.OVERDECK_NO_RESUME;
    else process.env.OVERDECK_NO_RESUME = originalNoResume;
    if (originalResume === undefined) delete process.env.OVERDECK_RESUME;
    else process.env.OVERDECK_RESUME = originalResume;
  });

  it('reflects OVERDECK_NO_RESUME changes after module import', async () => {
    const { getNoResumeMode } = await import('../no-resume-mode.js');

    expect(getNoResumeMode()).toEqual({ active: false, since: null });

    process.env.OVERDECK_NO_RESUME = '1';
    expect(getNoResumeMode()).toEqual({ active: true, since: BASE_TIME.toISOString() });

    delete process.env.OVERDECK_NO_RESUME;
    expect(getNoResumeMode()).toEqual({ active: false, since: null });
  });

  it('does not expose a runtime mutator for no-resume mode', async () => {
    const noResumeMode = await import('../no-resume-mode.js');

    process.env.OVERDECK_NO_RESUME = '1';
    expect(noResumeMode.getNoResumeMode()).toEqual({ active: true, since: BASE_TIME.toISOString() });

    expect('disableNoResumeMode' in noResumeMode).toBe(false);
    expect(process.env.OVERDECK_NO_RESUME).toBe('1');
    expect(process.env.OVERDECK_RESUME).toBeUndefined();
  });

  it('recognizes Commander negated --no-resume options', async () => {
    const { Command } = await import('commander');
    const { isNoResumeCliOptionEnabled } = await import('../no-resume-mode.js');
    const command = new Command()
      .exitOverride()
      .option('--no-resume');

    command.parse(['node', 'pan', '--no-resume']);

    expect(isNoResumeCliOptionEnabled(command.opts())).toBe(true);
    expect(isNoResumeCliOptionEnabled({ noResume: true })).toBe(true);
    expect(isNoResumeCliOptionEnabled({ resume: true })).toBe(false);
    expect(isNoResumeCliOptionEnabled({})).toBe(false);
  });

  it('keeps runtime relaunch paths from consulting no-resume mode', () => {
    const runtimeGateFiles = [
      'deacon-auto-resume.ts',
      'deacon-review-status.ts',
      'idle-stack-reaper.ts',
      'closed-issue-reaper.ts',
    ];

    for (const fileName of runtimeGateFiles) {
      const source = readFileSync(resolve(CLOISTER_DIR, fileName), 'utf-8');
      expect(source).not.toContain('getNoResumeMode');
      expect(source).not.toContain('OVERDECK_NO_RESUME');
    }
  });

  describe('isExplicitNoResumeRequest (PAN-2278)', () => {
    it('is false when OVERDECK_NO_RESUME is not set, regardless of gate source', async () => {
      const { isExplicitNoResumeRequest } = await import('../no-resume-mode.js');

      expect(isExplicitNoResumeRequest({})).toBe(false);
      expect(isExplicitNoResumeRequest({ OVERDECK_RESUME_GATE_SOURCE: 'flag' })).toBe(false);
      expect(isExplicitNoResumeRequest({ OVERDECK_NO_RESUME: '0' })).toBe(false);
    });

    it('treats the boot-gates default stamp as non-explicit — the dialog path must run', async () => {
      const { isExplicitNoResumeRequest } = await import('../no-resume-mode.js');

      expect(isExplicitNoResumeRequest({
        OVERDECK_NO_RESUME: '1',
        OVERDECK_RESUME_GATE_SOURCE: 'default',
      })).toBe(false);
      expect(isExplicitNoResumeRequest({
        OVERDECK_NO_RESUME: 'true',
        OVERDECK_RESUME_GATE_SOURCE: ' DEFAULT ',
      })).toBe(false);
    });

    it('treats flag and env sources — and a missing source — as explicit requests', async () => {
      const { isExplicitNoResumeRequest } = await import('../no-resume-mode.js');

      expect(isExplicitNoResumeRequest({
        OVERDECK_NO_RESUME: '1',
        OVERDECK_RESUME_GATE_SOURCE: 'flag',
      })).toBe(true);
      expect(isExplicitNoResumeRequest({
        OVERDECK_NO_RESUME: '1',
        OVERDECK_RESUME_GATE_SOURCE: 'env',
      })).toBe(true);
      // Manual operator export without boot-gates involvement stays explicit.
      expect(isExplicitNoResumeRequest({ OVERDECK_NO_RESUME: '1' })).toBe(true);
    });

    it('keeps boot reconciliation on the explicit-request door, not the raw env', () => {
      const source = readFileSync(resolve(CLOISTER_DIR, 'boot-reconciliation.ts'), 'utf-8');
      expect(source).toContain('isExplicitNoResumeRequest()');
      expect(source).not.toContain('getNoResumeMode()');
    });
  });
});
