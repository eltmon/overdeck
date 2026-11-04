import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/access-tokens.js', () => ({ listActiveRecordsOfKind: vi.fn(() => []) }));
vi.mock('../directory-client.js', () => ({ currentDirectoryClient: vi.fn(() => null) }));

import { listActiveRecordsOfKind } from '../../../../lib/access-tokens.js';
import { LIVE_ACTIVITY_POLL_MS } from '../../../../lib/push/live-activity-sender.js';
import { currentDirectoryClient } from '../directory-client.js';
import {
  activityPhoneIds,
  readLiveActivityCounts,
  RUNNING_AGENT_STATUSES,
  startLiveActivityService,
  stopLiveActivityService,
} from '../live-activity-service.js';

const PHONE = '00000000-0000-4000-9000-000000000001';

describe('live activity service (PAN-4839 WI-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopLiveActivityService();
    vi.useRealTimers();
    vi.mocked(listActiveRecordsOfKind).mockReset().mockReturnValue([]);
    vi.mocked(currentDirectoryClient).mockReset().mockReturnValue(null);
  });

  it('counts the needs-you feed and the agents in the dashboard pill’s running set', async () => {
    const counts = await readLiveActivityCounts({
      needsYou: async () => ({ hash: 'h', conversations: [{ id: 'c-1' }, { id: 'c-2' }], agents: [{ id: 'a-1', issueId: null, pendingInputKinds: ['question'] }] }),
      agents: async () => ['running', 'starting', 'stopped', 'error', 'thinking'].map((status, i) => ({ id: `a-${i}`, status })),
    });
    expect(counts).toEqual({ needsYou: 3, running: 3 });
    expect([...RUNNING_AGENT_STATUSES].sort()).toEqual(['active', 'running', 'starting', 'thinking', 'working']);
  });

  it('lists the phone records’ client ids and skips a record without one', () => {
    vi.mocked(listActiveRecordsOfKind).mockReturnValue([{ clientId: PHONE }, { label: 'old phone' }] as never);
    expect(activityPhoneIds()).toEqual([PHONE]);
    expect(listActiveRecordsOfKind).toHaveBeenCalledWith('phone');
  });

  it('starts one interval however often it is started', async () => {
    vi.mocked(listActiveRecordsOfKind).mockReturnValue([{ clientId: PHONE }] as never);
    startLiveActivityService();
    startLiveActivityService();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    // One tick per poll: each tick reads the phone list once before it sees no directory.
    expect(listActiveRecordsOfKind).toHaveBeenCalledTimes(1);
    expect(currentDirectoryClient).toHaveBeenCalledTimes(1);
    stopLiveActivityService();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS * 2);
    expect(listActiveRecordsOfKind).toHaveBeenCalledTimes(1);
  });
});
