import { describe, expect, it } from 'vitest';

import { buildCompactRecoverySeedMessage, isContextOverflowTail } from '../context-overflow.js';

describe('context overflow helpers', () => {
  it('detects overflow errors only in the recent pane tail', () => {
    expect(isContextOverflowTail('API Error: 400 Your input exceeds the context window of this model.\n❯')).toBe(true);

    const staleOverflow = [
      'API Error: 400 Your input exceeds the context window of this model.',
      ...Array.from({ length: 40 }, (_, i) => `later line ${i}`),
      '❯',
    ].join('\n');
    expect(isContextOverflowTail(staleOverflow)).toBe(false);
  });

  it('builds a fresh-session compact recovery seed that includes the archived summary', () => {
    const seed = buildCompactRecoverySeedMessage('PAN-1781', 'Implemented the respawn path and updated deacon recovery.');

    expect(seed).toContain('Your previous session for PAN-1781 hit the model');
    expect(seed).toContain('Summary of the archived session:');
    expect(seed).toContain('Implemented the respawn path');
    expect(seed).toContain('Reconstruct your exact work-in-progress from durable artifacts:');
    expect(seed).toContain('do not wait for further instructions');
  });

  it('falls back to durable-artifact reconstruction when no summary is available', () => {
    const seed = buildCompactRecoverySeedMessage('PAN-1781', null);

    expect(seed).not.toContain('Summary of the archived session:');
    expect(seed).toContain('Read .pan/continue.json');
    expect(seed).toContain('Inspect `git status` and `git diff`');
  });
});
