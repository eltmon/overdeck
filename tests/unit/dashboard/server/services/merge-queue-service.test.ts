import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllActiveQueuesMock } = vi.hoisted(() => ({
  getAllActiveQueuesMock: vi.fn(),
}));

vi.mock('../../../../../src/lib/database/merge-queue-db.js', () => ({
  getAllActiveQueues: getAllActiveQueuesMock,
}));

import {
  resumeQueuedMerges,
  setMergeQueueTriggerHandler,
} from '../../../../../src/dashboard/server/services/merge-queue-service.js';

describe('merge-queue-service', () => {
  const triggerHandler = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    setMergeQueueTriggerHandler(triggerHandler);
  });

  it('resumes the head queued merge for each idle project', async () => {
    getAllActiveQueuesMock.mockReturnValue([
      { projectKey: 'pan', current: null, queue: ['PAN-2', 'PAN-3'], queueLength: 2 },
      { projectKey: 'min', current: 'MIN-1', queue: ['MIN-2'], queueLength: 1 },
      { projectKey: 'ops', current: null, queue: ['OPS-9'], queueLength: 1 },
    ]);

    await resumeQueuedMerges();

    expect(triggerHandler).toHaveBeenCalledTimes(2);
    expect(triggerHandler).toHaveBeenCalledWith('PAN-2');
    expect(triggerHandler).toHaveBeenCalledWith('OPS-9');
  });

  it('does nothing when every project already has an active merge', async () => {
    getAllActiveQueuesMock.mockReturnValue([
      { projectKey: 'pan', current: 'PAN-1', queue: ['PAN-2'], queueLength: 1 },
    ]);

    await resumeQueuedMerges();

    expect(triggerHandler).not.toHaveBeenCalled();
  });
});
