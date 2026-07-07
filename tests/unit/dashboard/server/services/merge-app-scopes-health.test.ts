import { describe, expect, it, vi } from 'vitest';
import {
  shouldWarnAppCannotMerge,
  warnIfAppCannotMerge,
} from '../../../../../src/dashboard/server/services/merge-app-scopes-health.js';

describe('shouldWarnAppCannotMerge', () => {
  it('returns true when the App is configured but cannot merge', () => {
    expect(shouldWarnAppCannotMerge({ configured: true, canMerge: false, missing: ['contents:write'], detail: '' })).toBe(true);
  });

  it('returns false when the App can merge', () => {
    expect(shouldWarnAppCannotMerge({ configured: true, canMerge: true, missing: [], detail: '' })).toBe(false);
  });

  it('returns false when the App is not configured', () => {
    expect(shouldWarnAppCannotMerge({ configured: false, detail: '' })).toBe(false);
  });
});

describe('warnIfAppCannotMerge', () => {
  it('emits a warning and activity entry naming the missing scope', async () => {
    const warn = vi.fn();
    const emit = vi.fn();
    await warnIfAppCannotMerge({
      getResult: async () => ({
        configured: true,
        canMerge: false,
        missing: ['contents:write'],
        detail: 'Missing required permissions: contents:write',
      }),
      warn,
      emit,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const warning = warn.mock.calls[0][0];
    expect(warning).toContain('contents:write');
    expect(warning).toContain('Grant these permissions');

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      source: 'dashboard',
      level: 'warn',
      message: expect.stringContaining('contents:write'),
    }));
  });

  it('stays silent when the App can merge', async () => {
    const warn = vi.fn();
    const emit = vi.fn();
    await warnIfAppCannotMerge({
      getResult: async () => ({
        configured: true,
        canMerge: true,
        missing: [],
        detail: 'OK',
      }),
      warn,
      emit,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('stays silent when the App is not configured', async () => {
    const warn = vi.fn();
    const emit = vi.fn();
    await warnIfAppCannotMerge({
      getResult: async () => ({ configured: false, detail: 'Not configured' }),
      warn,
      emit,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('logs a warning if the probe itself throws', async () => {
    const warn = vi.fn();
    const emit = vi.fn();
    await warnIfAppCannotMerge({
      getResult: async () => { throw new Error('token mint failed'); },
      warn,
      emit,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token mint failed'));
    expect(emit).not.toHaveBeenCalled();
  });
});
