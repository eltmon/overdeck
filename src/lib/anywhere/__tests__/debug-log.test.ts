import { afterEach, describe, expect, it, vi } from 'vitest';

import { anywhereDebug, anywhereDebugEnabled, shortId } from '../debug-log.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('anywhereDebug', () => {
  it('prints with an [anywhere] prefix when OVERDECK_ANYWHERE_DEBUG=1', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    anywhereDebug('x', { OVERDECK_ANYWHERE_DEBUG: '1' });
    expect(warn).toHaveBeenCalledWith('[anywhere] x');
  });

  it.each([{}, { OVERDECK_ANYWHERE_DEBUG: '0' }, { OVERDECK_ANYWHERE_DEBUG: 'true' }])('prints nothing for %j', (env) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    anywhereDebug('x', env);
    expect(anywhereDebugEnabled(env)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('shortId', () => {
  it('cuts an id to its first 8 characters', () => {
    expect(shortId('0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b')).toBe('0b5c6c1e');
  });
});
