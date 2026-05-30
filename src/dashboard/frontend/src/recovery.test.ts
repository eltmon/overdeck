import { describe, it, expect } from 'vitest';
import { isModuleLoadError } from './recovery';

describe('isModuleLoadError', () => {
  it('matches the common dynamic-import failure messages', () => {
    const messages = [
      'Failed to fetch dynamically imported module: https://pan.localhost/assets/Foo-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'module script failed',
    ];
    for (const message of messages) {
      expect(isModuleLoadError(new Error(message)), message).toBe(true);
      expect(isModuleLoadError(message), message).toBe(true);
    }
  });

  it('ignores unrelated errors', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isModuleLoadError('some render bug')).toBe(false);
    expect(isModuleLoadError(undefined)).toBe(false);
    expect(isModuleLoadError(null)).toBe(false);
    expect(isModuleLoadError({})).toBe(false);
  });
});
