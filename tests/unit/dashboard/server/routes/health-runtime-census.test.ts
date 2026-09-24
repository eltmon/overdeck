import { describe, expect, it, vi } from 'vitest';

import { readHealthLiveAgentIds, readHealthSessionNames } from '../../../../../src/dashboard/server/routes/misc/health.js';

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

describe('health route live agents (#4109)', () => {
  const census = () => ({ sessionNames: new Set(['agent-legacy-tmux']) });

  it('adds the agents the backend inventory lists, so a live Herdr agent is not read as dead', async () => {
    const ids = await readHealthLiveAgentIds(census, async () => new Set(['agent-herdr']));
    expect([...ids].sort()).toEqual(['agent-herdr', 'agent-legacy-tmux']);
  });

  it('throws when the backend inventory is unreadable, so the route answers unavailable', async () => {
    await expect(readHealthLiveAgentIds(census, async () => null))
      .rejects.toThrow('Terminal backend inventory is unreadable');
  });
});
