import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emitActivityEntrySync,
  emitActivityTtsSync,
  emitDashboardLifecycleSync,
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

  it('mirrors dashboard lifecycle events into the ActivityPanel feed', () => {
    emitDashboardLifecycleSync('started', {
      reason: 'post-merge',
      issueId: 'PAN-1744',
      trigger: 'deploy-script',
    });

    expect(store.appendAsync).not.toHaveBeenCalled();
    expect(store.append).toHaveBeenCalledTimes(2);
    expect(store.append.mock.calls[0][0]).toMatchObject({
      type: 'dashboard.lifecycle_started',
      payload: {
        reason: 'post-merge',
        issueId: 'PAN-1744',
        trigger: 'deploy-script',
      },
    });
    expect(store.append.mock.calls[1][0]).toMatchObject({
      type: 'activity.entry',
      payload: {
        source: 'deploy-script',
        level: 'info',
        message: 'Dashboard restart started via deploy-script for PAN-1744 (post-merge)',
        issueId: 'PAN-1744',
      },
    });
  });
});
