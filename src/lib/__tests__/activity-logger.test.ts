import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emitActivityEntrySync,
  emitActivityTtsSync,
  setActivityEventStoreProvider,
} from '../activity-logger.js';

const store = {
  append: vi.fn(() => 1),
  appendAsync: vi.fn(async () => 1),
};

describe('activity logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivityEventStoreProvider(() => store);
  });

  afterEach(() => {
    setActivityEventStoreProvider(null);
  });

  it('persists activity events asynchronously', () => {
    emitActivityEntrySync({ source: 'cloister', level: 'info', message: 'review started', issueId: 'PAN-829' });
    emitActivityTtsSync({ utterance: 'PAN-829 review started', issueId: 'PAN-829' });

    expect(store.append).not.toHaveBeenCalled();
    expect(store.appendAsync).toHaveBeenCalledTimes(2);
    expect(store.appendAsync.mock.calls[0][0]).toMatchObject({ type: 'activity.entry' });
    expect(store.appendAsync.mock.calls[1][0]).toMatchObject({ type: 'activity.tts' });
  });
});
