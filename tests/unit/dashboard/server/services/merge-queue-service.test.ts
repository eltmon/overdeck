import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllActiveQueuesMock } = vi.hoisted(() => ({
  getAllActiveQueuesMock: vi.fn(),
}));

vi.mock('../../../../../src/lib/overdeck/merge-sync.js', () => ({
  getAllActiveQueues: getAllActiveQueuesMock,
}));

import {
  resumeQueuedMerges,
  setMergeQueueAdvanceHandler,
} from '../../../../../src/dashboard/server/services/merge-queue-service.js';

describe('merge-queue-service', () => {
  const advanceHandler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setMergeQueueAdvanceHandler(advanceHandler);
  });

  // PAN-3328: boot recovery hands the whole project queue to the advance, not the
  // single head issue. Handing over `queue[0]` meant a head that could no longer
  // merge bounced on every boot and nothing behind it was ever reached.
  it('advances each idle project queue rather than triggering its head issue', async () => {
    getAllActiveQueuesMock.mockReturnValue([
      { projectKey: 'pan', current: null, queue: ['PAN-2', 'PAN-3'], queueLength: 2 },
      { projectKey: 'min', current: 'MIN-1', queue: ['MIN-2'], queueLength: 1 },
      { projectKey: 'ops', current: null, queue: ['OPS-9'], queueLength: 1 },
    ]);

    await resumeQueuedMerges();

    expect(advanceHandler).toHaveBeenCalledTimes(2);
    expect(advanceHandler).toHaveBeenCalledWith('pan');
    expect(advanceHandler).toHaveBeenCalledWith('ops');
  });

  it('does nothing when every project already has an active merge', async () => {
    getAllActiveQueuesMock.mockReturnValue([
      { projectKey: 'pan', current: 'PAN-1', queue: ['PAN-2'], queueLength: 1 },
    ]);

    await resumeQueuedMerges();

    expect(advanceHandler).not.toHaveBeenCalled();
  });

  it('does nothing for a project whose queue is empty', async () => {
    getAllActiveQueuesMock.mockReturnValue([
      { projectKey: 'pan', current: null, queue: [], queueLength: 0 },
    ]);

    await resumeQueuedMerges();

    expect(advanceHandler).not.toHaveBeenCalled();
  });
});
