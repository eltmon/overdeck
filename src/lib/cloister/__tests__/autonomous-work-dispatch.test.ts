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
  readAutoSpawnOnFinalizeFlag: vi.fn(),
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
  readAutoSpawnOnFinalizeFlag: mocks.readAutoSpawnOnFinalizeFlag,
}));

import {
  decideAutonomousWorkDispatch,
  gatherAutonomousWorkDispatchInput,
  type AutonomousWorkDispatchInput,
} from '../autonomous-work-dispatch.js';

function input(overrides: Partial<AutonomousWorkDispatchInput> = {}): AutonomousWorkDispatchInput {
  return {
    labels: [READY_LABEL, RELEASED_LABEL],
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

  it('rejects a ready issue without a release source', () => {
    const decision = decideAutonomousWorkDispatch(input({ labels: [READY_LABEL] }));

    expect(decision).toMatchObject({ allow: false, code: 'not-released' });
    expect(decision.reason).toContain('no release override applies');
  });

  it.each([
    ['released label', { labels: [READY_LABEL, RELEASED_LABEL] }],
    ['auto-pickup', { labels: [READY_LABEL], autoPickupBacklog: true }],
    ['active order-book membership', { labels: [READY_LABEL], activeBookMember: true }],
    ['auto-start consent', { labels: [READY_LABEL], autoSpawnOnFinalizeConsent: true }],
  ] as const)('allows a ready issue when released by %s', (_source, overrides) => {
    expect(decideAutonomousWorkDispatch(input(overrides))).toEqual({ allow: true });
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
    mocks.getIssues.mockReturnValue([
      {
        identifier: 'PAN-3111',
        labels: [READY_LABEL, { name: RELEASED_LABEL }, null],
      },
    ]);
    mocks.isFlywheelAutoPickupBacklog.mockReturnValue(true);
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/repo',
    });
    mocks.activeOrderBookIssues.mockResolvedValue(new Set(['PAN-3111']));
    mocks.readAutoSpawnOnFinalizeFlag.mockReturnValue(true);
  });

  it('gathers labels and every release source for the normalized issue ID', async () => {
    await expect(gatherAutonomousWorkDispatchInput(' pan-3111 ', { getIssues: mocks.getIssues })).resolves.toEqual({
      labels: [READY_LABEL, RELEASED_LABEL],
      autoPickupBacklog: true,
      activeBookMember: true,
      autoSpawnOnFinalizeConsent: true,
    });
    expect(mocks.activeOrderBookIssues).toHaveBeenCalledWith('/repo');
    expect(mocks.readAutoSpawnOnFinalizeFlag).toHaveBeenCalledWith('PAN-3111');
  });

  it('uses safe defaults when issue, settings, order-book, and consent reads fail', async () => {
    mocks.getIssues.mockImplementation(() => {
      throw new Error('issue service unavailable');
    });
    mocks.isFlywheelAutoPickupBacklog.mockImplementation(() => {
      throw new Error('settings unavailable');
    });
    mocks.activeOrderBookIssues.mockRejectedValue(new Error('order book unavailable'));
    mocks.readAutoSpawnOnFinalizeFlag.mockImplementation(() => {
      throw new Error('flag unavailable');
    });

    await expect(gatherAutonomousWorkDispatchInput('PAN-3111', { getIssues: mocks.getIssues })).resolves.toEqual({
      labels: null,
      autoPickupBacklog: false,
      activeBookMember: false,
      autoSpawnOnFinalizeConsent: false,
    });
  });

  it('treats unresolved projects and missing issues as unavailable release inputs', async () => {
    mocks.getIssues.mockReturnValue([]);
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    const gathered = await gatherAutonomousWorkDispatchInput('PAN-3111', { getIssues: mocks.getIssues });

    expect(gathered.labels).toBeNull();
    expect(gathered.activeBookMember).toBe(false);
    expect(mocks.activeOrderBookIssues).not.toHaveBeenCalled();
  });
});
