import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  append: vi.fn(),
  appendAsync: vi.fn(async () => undefined),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  getEventStore: () => store,
}));

import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';

describe('activity logger', () => {
  it('persists activity events asynchronously', () => {
    emitActivityEntrySync({ source: 'cloister', level: 'info', message: 'review started', issueId: 'PAN-829' });
    emitActivityTtsSync({ utterance: 'PAN-829 review started', issueId: 'PAN-829' });

    expect(store.append).not.toHaveBeenCalled();
    expect(store.appendAsync).toHaveBeenCalledTimes(2);
    expect(store.appendAsync.mock.calls[0][0]).toMatchObject({ type: 'activity.entry' });
    expect(store.appendAsync.mock.calls[1][0]).toMatchObject({ type: 'activity.tts' });
  });
});
