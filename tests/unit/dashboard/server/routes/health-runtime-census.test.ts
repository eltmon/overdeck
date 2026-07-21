import { describe, expect, it, vi } from 'vitest';

import { readHealthSessionNames } from '../../../../../src/dashboard/server/routes/misc/health.js';

describe('health route runtime census', () => {
  it('reads session names from the published census without refreshing it', () => {
    const readSnapshot = vi.fn(() => ({
      sessionNames: new Set(['agent-pan-1', 'conv-1']),
    }));

    expect(readHealthSessionNames(readSnapshot)).toEqual(['agent-pan-1', 'conv-1']);
    expect(readSnapshot).toHaveBeenCalledOnce();
  });

  it('fails fast while the census snapshot is cold', () => {
    expect(() => readHealthSessionNames(() => null))
      .toThrow('Runtime census snapshot is warming');
  });
});
