import { describe, expect, it } from 'vitest';

import { isProjectSpecialistActivelyRunning } from '../../../src/lib/cloister/specialists.js';

describe('isProjectSpecialistActivelyRunning', () => {
  it('treats active runtime state as running', () => {
    expect(isProjectSpecialistActivelyRunning({ state: 'active' }, false)).toBe(true);
  });

  it('treats idle runtime state as not running even if wrapper processes still exist', () => {
    expect(isProjectSpecialistActivelyRunning({ state: 'idle' }, true)).toBe(false);
  });

  it('treats suspended runtime state as not running', () => {
    expect(isProjectSpecialistActivelyRunning({ state: 'suspended' }, true)).toBe(false);
  });

  it('falls back to process detection when there is no runtime state', () => {
    expect(isProjectSpecialistActivelyRunning(undefined, true)).toBe(true);
    expect(isProjectSpecialistActivelyRunning(undefined, false)).toBe(false);
  });
});
