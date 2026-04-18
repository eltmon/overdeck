import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRunServerPipe,
  mockStartSharedIssueService,
  mockStartAgentEnrichmentService,
  mockStopAgentEnrichmentService,
  mockStartConversationLifecycleService,
  mockStopConversationLifecycleService,
  mockInitTrackerConfigCache,
  mockProcessPendingLifecycle,
  mockSetPipelineHandler,
  mockClearStuckMergeStatuses,
  mockFixStuckReadyForMerge,
  mockGetReviewStatus,
  mockClearStuckForks,
  mockGetEventStore,
  mockEmitActivityEntry,
  mockGetCloisterService,
  mockShouldAutoStart,
  mockSetAgentStoppedNotifier,
  mockSetMergeReadyNotifier,
  mockResumeQueuedMerges,
  mockResetProcessingToQueued,
  mockRepairMergedLabels,
  mockRepairAlreadyMergedPRs,
  mockRepairIncompletePostMergeLifecycle,
  mockRepairClosedWontfixIssues,
  mockRepairClosedPRs,
  mockNodeRunMain,
  mockBunRunMain,
} = vi.hoisted(() => ({
  mockRunServerPipe: vi.fn(() => 'main-effect'),
  mockStartSharedIssueService: vi.fn().mockResolvedValue(undefined),
  mockStartAgentEnrichmentService: vi.fn(),
  mockStopAgentEnrichmentService: vi.fn(),
  mockStartConversationLifecycleService: vi.fn(),
  mockStopConversationLifecycleService: vi.fn(),
  mockInitTrackerConfigCache: vi.fn().mockResolvedValue(undefined),
  mockProcessPendingLifecycle: vi.fn().mockResolvedValue(undefined),
  mockSetPipelineHandler: vi.fn(),
  mockClearStuckMergeStatuses: vi.fn(),
  mockFixStuckReadyForMerge: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockClearStuckForks: vi.fn(() => 0),
  mockGetEventStore: vi.fn(() => ({ append: vi.fn() })),
  mockEmitActivityEntry: vi.fn(),
  mockGetCloisterService: vi.fn(() => ({ start: vi.fn().mockResolvedValue(undefined) })),
  mockShouldAutoStart: vi.fn(() => false),
  mockSetAgentStoppedNotifier: vi.fn(),
  mockSetMergeReadyNotifier: vi.fn(),
  mockResumeQueuedMerges: vi.fn().mockResolvedValue(undefined),
  mockResetProcessingToQueued: vi.fn(() => 0),
  mockRepairMergedLabels: vi.fn().mockResolvedValue(undefined),
  mockRepairAlreadyMergedPRs: vi.fn().mockResolvedValue(undefined),
  mockRepairIncompletePostMergeLifecycle: vi.fn().mockResolvedValue(undefined),
  mockRepairClosedWontfixIssues: vi.fn().mockResolvedValue(undefined),
  mockRepairClosedPRs: vi.fn().mockResolvedValue(undefined),
  mockNodeRunMain: vi.fn(),
  mockBunRunMain: vi.fn(),
}));

vi.mock('../config.js', () => ({
  ServerConfigLayer: Symbol('ServerConfigLayer'),
}));

vi.mock('../server.js', () => ({
  runServer: {
    pipe: mockRunServerPipe,
  },
}));

vi.mock('../services/issue-service-singleton.js', () => ({
  startSharedIssueService: mockStartSharedIssueService,
}));

vi.mock('../services/agent-enrichment-service.js', () => ({
  startAgentEnrichmentService: mockStartAgentEnrichmentService,
  stopAgentEnrichmentService: mockStopAgentEnrichmentService,
}));

vi.mock('../services/conversation-lifecycle.js', () => ({
  startConversationLifecycleService: mockStartConversationLifecycleService,
  stopConversationLifecycleService: mockStopConversationLifecycleService,
}));

vi.mock('../services/tracker-config.js', () => ({
  initTrackerConfigCache: mockInitTrackerConfigCache,
}));

vi.mock('../pending-lifecycle.js', () => ({
  processPendingLifecycle: mockProcessPendingLifecycle,
}));

vi.mock('../../../lib/pipeline-notifier.js', () => ({
  setPipelineHandler: mockSetPipelineHandler,
}));

vi.mock('../../../lib/review-status.js', () => ({
  clearStuckMergeStatuses: mockClearStuckMergeStatuses,
  fixStuckReadyForMerge: mockFixStuckReadyForMerge,
  getReviewStatus: mockGetReviewStatus,
}));

vi.mock('../../../lib/database/conversations-db.js', () => ({
  clearStuckForks: mockClearStuckForks,
}));

vi.mock('../event-store.js', () => ({
  getEventStore: mockGetEventStore,
}));

vi.mock('../../../lib/activity-logger.js', () => ({
  emitActivityEntry: mockEmitActivityEntry,
}));

vi.mock('../../../lib/cloister/service.js', () => ({
  getCloisterService: mockGetCloisterService,
}));

vi.mock('../../../lib/cloister/config.js', () => ({
  shouldAutoStart: mockShouldAutoStart,
}));

vi.mock('../../../lib/cloister/deacon.js', () => ({
  setAgentStoppedNotifier: mockSetAgentStoppedNotifier,
  setMergeReadyNotifier: mockSetMergeReadyNotifier,
}));

vi.mock('../services/merge-queue-service.js', () => ({
  resumeQueuedMerges: mockResumeQueuedMerges,
}));

vi.mock('../../../lib/database/merge-queue-db.js', () => ({
  resetProcessingToQueued: mockResetProcessingToQueued,
}));

vi.mock('../../../lib/lifecycle/label-cleanup.js', () => ({
  repairMergedLabels: mockRepairMergedLabels,
  repairAlreadyMergedPRs: mockRepairAlreadyMergedPRs,
  repairIncompletePostMergeLifecycle: mockRepairIncompletePostMergeLifecycle,
  repairClosedWontfixIssues: mockRepairClosedWontfixIssues,
  repairClosedPRs: mockRepairClosedPRs,
}));

vi.mock('@effect/platform-node/NodeRuntime', () => ({
  runMain: mockNodeRunMain,
}));

vi.mock('@effect/platform-bun/BunRuntime', () => ({
  runMain: mockBunRunMain,
}));

describe('dashboard main boot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRunServerPipe.mockReturnValue('main-effect');
    mockStartSharedIssueService.mockResolvedValue(undefined);
    mockInitTrackerConfigCache.mockResolvedValue(undefined);
    mockProcessPendingLifecycle.mockResolvedValue(undefined);
    mockResumeQueuedMerges.mockResolvedValue(undefined);
    mockResetProcessingToQueued.mockReturnValue(0);
    mockClearStuckForks.mockReturnValue(0);
    mockShouldAutoStart.mockReturnValue(false);
  });

  it('boots without any startup attachment cleanup', async () => {
    await import('../main.ts');

    expect(mockStartConversationLifecycleService).toHaveBeenCalledTimes(1);
    expect(mockProcessPendingLifecycle).toHaveBeenCalledTimes(1);
    expect(mockNodeRunMain).toHaveBeenCalledWith('main-effect');
  });
});
