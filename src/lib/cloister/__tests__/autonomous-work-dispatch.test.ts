import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EPIC_LABEL,
  LEGACY_PARKED_LABELS,
  OBJECTION_LABEL,
  PARKED_LABEL,
  READY_LABEL,
  RELEASED_LABEL,
  VETOED_LABEL,
} from '../../backlog/pickup.js';

const mocks = vi.hoisted(() => ({
  getIssues: vi.fn(),
  isFlywheelAutoPickupBacklog: vi.fn(),
  activeOrderBookIssues: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  readAutoSpawnOnFinalizeFlagAsync: vi.fn(),
  findPlannedState: vi.fn(),
}));

vi.mock('../../overdeck/control-settings.js', () => ({
  isFlywheelAutoPickupBacklog: mocks.isFlywheelAutoPickupBacklog,
}));

vi.mock('../flywheel.js', () => ({
  activeOrderBookIssues: mocks.activeOrderBookIssues,
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../planning/spawn-planning-session.js', () => ({
  readAutoSpawnOnFinalizeFlagAsync: mocks.readAutoSpawnOnFinalizeFlagAsync,
}));

import {
  clearAutonomousWorkDispatchCaches,
  decideAutonomousWorkDispatch,
  gatherAutonomousWorkDispatchInput,
  type AutonomousWorkDispatchInput,
} from '../autonomous-work-dispatch.js';

const gatherDeps = () => ({
  getIssues: mocks.getIssues,
  findPlannedState: mocks.findPlannedState,
});

function input(overrides: Partial<AutonomousWorkDispatchInput> = {}): AutonomousWorkDispatchInput {
  return {
    labels: [READY_LABEL, RELEASED_LABEL],
    planned: true,
    autoPickupBacklog: false,
    activeBookMember: false,
    autoSpawnOnFinalizeConsent: false,
    ...overrides,
  };
}

describe('decideAutonomousWorkDispatch', () => {
  it('fails closed when tracker labels are unavailable', () => {
    const decision = decideAutonomousWorkDispatch(input({
      labels: null,
      autoPickupBacklog: true,
      activeBookMember: true,
      autoSpawnOnFinalizeConsent: true,
    }));

    expect(decision).toMatchObject({ allow: false, code: 'labels-unavailable' });
    expect(decision.reason).toContain('run pan start manually');
  });

  it.each([
    [PARKED_LABEL, 'parked'],
    [LEGACY_PARKED_LABELS[0].toUpperCase(), 'parked'],
    [LEGACY_PARKED_LABELS[1], 'parked'],
    [VETOED_LABEL, 'vetoed'],
    [OBJECTION_LABEL, 'objection'],
    [EPIC_LABEL, 'epic'],
  ] as const)('rejects the %s blocker with code %s', (label, code) => {
    const decision = decideAutonomousWorkDispatch(input({
      labels: [READY_LABEL.toUpperCase(), RELEASED_LABEL.toUpperCase(), label],
      autoPickupBacklog: true,
      activeBookMember: true,
      autoSpawnOnFinalizeConsent: true,
    }));

    expect(decision).toMatchObject({ allow: false, code });
  });

  it('rejects an issue without the ready label', () => {
    const decision = decideAutonomousWorkDispatch(input({ labels: [RELEASED_LABEL] }));

    expect(decision).toMatchObject({ allow: false, code: 'not-ready' });
    expect(decision.reason).toContain('Add the ready label');
  });

  it('rejects a ready issue without an active implementation plan', () => {
    const decision = decideAutonomousWorkDispatch(input({ planned: false }));

    expect(decision).toMatchObject({ allow: false, code: 'not-planned' });
  });

  it('rejects a ready issue without a release source', () => {
    const decision = decideAutonomousWorkDispatch(input({ labels: [READY_LABEL] }));

    expect(decision).toMatchObject({ allow: false, code: 'not-released' });
    expect(decision.reason).toContain('no release override applies');
  });

  it.each([
    ['released label', { labels: [READY_LABEL, RELEASED_LABEL] }, 'released-label'],
    ['auto-pickup', { labels: [READY_LABEL], autoPickupBacklog: true }, 'auto-pickup'],
    ['active order-book membership', { labels: [READY_LABEL], activeBookMember: true }, 'active-order-book'],
    ['auto-start consent', { labels: [READY_LABEL], autoSpawnOnFinalizeConsent: true }, 'planning-consent'],
  ] as const)('allows a ready issue when released by %s', (_source, overrides, releaseSource) => {
    expect(decideAutonomousWorkDispatch(input(overrides))).toEqual({ allow: true, releaseSource });
  });

  it('applies blocker precedence before readiness and release checks', () => {
    expect(decideAutonomousWorkDispatch(input({
      labels: [OBJECTION_LABEL, VETOED_LABEL, PARKED_LABEL, EPIC_LABEL],
    }))).toMatchObject({ allow: false, code: 'parked' });

    expect(decideAutonomousWorkDispatch(input({
      labels: [OBJECTION_LABEL, VETOED_LABEL, EPIC_LABEL],
    }))).toMatchObject({ allow: false, code: 'vetoed' });
  });
});

describe('gatherAutonomousWorkDispatchInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAutonomousWorkDispatchCaches();
    mocks.getIssues.mockReturnValue([
      {
        identifier: 'PAN-3111',
        labels: [{ name: READY_LABEL }, null],
      },
    ]);
    mocks.isFlywheelAutoPickupBacklog.mockReturnValue(true);
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/repo',
    });
    mocks.activeOrderBookIssues.mockResolvedValue(new Set(['PAN-3111']));
    mocks.readAutoSpawnOnFinalizeFlagAsync.mockResolvedValue(true);
    mocks.findPlannedState.mockResolvedValue({ status: 'proposed', itemCount: 1 });
  });

  it('gathers labels and every release source for the normalized issue ID', async () => {
    await expect(gatherAutonomousWorkDispatchInput(' pan-3111 ', gatherDeps())).resolves.toEqual({
      labels: [READY_LABEL],
      planned: true,
      autoPickupBacklog: true,
      activeBookMember: true,
      autoSpawnOnFinalizeConsent: true,
    });
    expect(mocks.activeOrderBookIssues).toHaveBeenCalledWith('/repo');
    expect(mocks.readAutoSpawnOnFinalizeFlagAsync).toHaveBeenCalledWith('PAN-3111');
  });

  it('uses safe defaults when issue, settings, order-book, and consent reads fail', async () => {
    mocks.getIssues.mockImplementation(() => {
      throw new Error('issue service unavailable');
    });
    mocks.isFlywheelAutoPickupBacklog.mockImplementation(() => {
      throw new Error('settings unavailable');
    });
    mocks.activeOrderBookIssues.mockRejectedValue(new Error('order book unavailable'));
    mocks.readAutoSpawnOnFinalizeFlagAsync.mockRejectedValue(new Error('flag unavailable'));

    await expect(gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps())).resolves.toEqual({
      labels: null,
      planned: false,
      autoPickupBacklog: false,
      activeBookMember: false,
      autoSpawnOnFinalizeConsent: false,
    });
  });

  it('short-circuits storage reads for blocked, unready, and unplanned issues', async () => {
    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-3111', labels: [READY_LABEL, PARKED_LABEL] }]);
    await gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps());
    expect(mocks.findPlannedState).not.toHaveBeenCalled();

    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-3111', labels: [] }]);
    await gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps());
    expect(mocks.findPlannedState).not.toHaveBeenCalled();

    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-3111', labels: [READY_LABEL] }]);
    mocks.findPlannedState.mockResolvedValue(null);
    await gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps());
    expect(mocks.isFlywheelAutoPickupBacklog).not.toHaveBeenCalled();
    expect(mocks.activeOrderBookIssues).not.toHaveBeenCalled();
    expect(mocks.readAutoSpawnOnFinalizeFlagAsync).not.toHaveBeenCalled();
  });

  it('short-circuits release-source reads for a planned issue with the released label', async () => {
    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-3111', labels: [READY_LABEL, RELEASED_LABEL] }]);

    await expect(gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps())).resolves.toEqual({
      labels: [READY_LABEL, RELEASED_LABEL],
      planned: true,
      autoPickupBacklog: false,
      activeBookMember: false,
      autoSpawnOnFinalizeConsent: false,
    });
    expect(mocks.isFlywheelAutoPickupBacklog).not.toHaveBeenCalled();
    expect(mocks.activeOrderBookIssues).not.toHaveBeenCalled();
    expect(mocks.readAutoSpawnOnFinalizeFlagAsync).not.toHaveBeenCalled();
  });

  it('caches shared release inputs across candidates in one patrol window', async () => {
    await gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps());
    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-3112', labels: [READY_LABEL] }]);
    mocks.findPlannedState.mockResolvedValue({ status: 'proposed', itemCount: 1 });
    await gatherAutonomousWorkDispatchInput('PAN-3112', gatherDeps());

    expect(mocks.isFlywheelAutoPickupBacklog).toHaveBeenCalledTimes(1);
    expect(mocks.activeOrderBookIssues).toHaveBeenCalledTimes(1);
  });

  it('treats unresolved projects and missing issues as unavailable release inputs', async () => {
    mocks.getIssues.mockReturnValue([]);
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    const gathered = await gatherAutonomousWorkDispatchInput('PAN-3111', gatherDeps());

    expect(gathered.labels).toBeNull();
    expect(gathered.activeBookMember).toBe(false);
    expect(mocks.activeOrderBookIssues).not.toHaveBeenCalled();
  });
});
