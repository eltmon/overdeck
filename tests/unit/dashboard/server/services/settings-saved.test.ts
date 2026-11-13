import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('../../../../../src/dashboard/server/services/tts-runtime-config.js', () => ({
  refreshTtsRuntimeConfig: vi.fn(async () => { calls.push('refreshTtsRuntimeConfig'); }),
}));
vi.mock('../../../../../src/dashboard/server/services/tts-playback.js', () => ({
  syncTtsPlaybackWithConfig: vi.fn(async () => { calls.push('syncTtsPlaybackWithConfig'); }),
}));
vi.mock('../../../../../src/dashboard/server/services/conversation-search-watcher.js', () => ({
  syncConversationSearchWatcher: vi.fn(async () => { calls.push('syncConversationSearchWatcher'); }),
}));

import { applySavedSettings } from '../../../../../src/dashboard/server/services/settings-saved.js';
import { resetHostToolsForTests, resolveHostTool, setHostToolFinderForTests } from '../../../../../src/lib/host-tools.js';

afterEach(() => {
  resetHostToolsForTests();
  calls.length = 0;
});

describe('applySavedSettings (PAN-5168)', () => {
  it('calls refreshTtsRuntimeConfig, syncTtsPlaybackWithConfig and syncConversationSearchWatcher in order', async () => {
    await applySavedSettings();

    expect(calls).toEqual(['refreshTtsRuntimeConfig', 'syncTtsPlaybackWithConfig', 'syncConversationSearchWatcher']);
  });

  it('forces a fresh host-tool lookup afterwards', async () => {
    let findCalls = 0;
    const find = () => { findCalls++; return '/fake/bin/docker'; };
    setHostToolFinderForTests(find);
    resolveHostTool('docker');
    expect(findCalls).toBe(1);

    await applySavedSettings();
    resolveHostTool('docker');

    expect(findCalls).toBe(2);
  });
});
