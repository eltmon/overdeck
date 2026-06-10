import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_TIME = new Date('2026-05-17T12:00:00.000Z');

describe('no-resume mode', () => {
  let originalNoResume: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.resetModules();
    originalNoResume = process.env.PANOPTICON_NO_RESUME;
    delete process.env.PANOPTICON_NO_RESUME;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    if (originalNoResume === undefined) delete process.env.PANOPTICON_NO_RESUME;
    else process.env.PANOPTICON_NO_RESUME = originalNoResume;
  });

  it('reflects PANOPTICON_NO_RESUME changes after module import', async () => {
    const { getNoResumeMode } = await import('../no-resume-mode.js');

    expect(getNoResumeMode()).toEqual({ active: false, since: null });

    process.env.PANOPTICON_NO_RESUME = '1';
    expect(getNoResumeMode()).toEqual({ active: true, since: BASE_TIME.toISOString() });

    delete process.env.PANOPTICON_NO_RESUME;
    expect(getNoResumeMode()).toEqual({ active: false, since: null });
  });
});
