import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  BOOT_RECONCILIATION_BOOT_ID_KEY,
  BOOT_RECONCILIATION_DECIDED_AT_KEY,
  BOOT_RECONCILIATION_DECISION_KEY,
  BOOT_RECONCILIATION_GRACE_DEADLINE_KEY,
  BOOT_RECONCILIATION_PER_AGENT_KEY,
  type BootReconciliationDecision,
  FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY,
  FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY,
  MERGE_TRAIN_ENABLED_KEY,
  LEGACY_FLYWHEEL_MERGE_TRAIN_ENABLED_KEY,
  getBootReconciliationState,
  getSetting,
  isFlywheelAutoPickupBacklog,
  isFlywheelRequireUatBeforeMerge,
  isMergeTrainEnabled,
  setBootReconciliationDecision,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
  setMergeTrainEnabled,
  setSetting,
  stampBootReconciliation,
} from '../app-settings.js';
import { resetDatabase } from '../index.js';

let testHome: string;

beforeEach(() => {
  testHome = join(tmpdir(), `pan-1486-app-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  resetDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('flywheel app settings', () => {
  it('defaults auto-pickup backlog to false on an empty database', () => {
    expect(isFlywheelAutoPickupBacklog()).toBe(false);
    expect(getSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY)).toBeNull();
  });

  it('round-trips the auto-pickup backlog flag', () => {
    setFlywheelAutoPickupBacklog(true);
    expect(isFlywheelAutoPickupBacklog()).toBe(true);
    expect(getSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY)).toBe('true');

    setFlywheelAutoPickupBacklog(false);
    expect(isFlywheelAutoPickupBacklog()).toBe(false);
    expect(getSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY)).toBe('false');
  });

  it('defaults require-UAT-before-merge to true on an empty database', () => {
    expect(isFlywheelRequireUatBeforeMerge()).toBe(true);
    expect(getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY)).toBeNull();
  });

  it('round-trips the require-UAT-before-merge flag', () => {
    setFlywheelRequireUatBeforeMerge(false);
    expect(isFlywheelRequireUatBeforeMerge()).toBe(false);
    expect(getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY)).toBe('false');

    setFlywheelRequireUatBeforeMerge(true);
    expect(isFlywheelRequireUatBeforeMerge()).toBe(true);
    expect(getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY)).toBe('true');
  });

  it('keeps the two flywheel keys independent', () => {
    setFlywheelAutoPickupBacklog(true);
    expect(isFlywheelAutoPickupBacklog()).toBe(true);
    expect(isFlywheelRequireUatBeforeMerge()).toBe(true);
    expect(getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY)).toBeNull();

    setFlywheelRequireUatBeforeMerge(false);
    expect(isFlywheelAutoPickupBacklog()).toBe(true);
    expect(isFlywheelRequireUatBeforeMerge()).toBe(false);
    expect(getSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY)).toBe('true');

    setFlywheelAutoPickupBacklog(false);
    expect(isFlywheelAutoPickupBacklog()).toBe(false);
    expect(isFlywheelRequireUatBeforeMerge()).toBe(false);
    expect(getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY)).toBe('false');
  });
});

describe('boot reconciliation app settings', () => {
  it('defaults to an empty state on an empty database', () => {
    expect(getBootReconciliationState()).toEqual({
      decision: null,
      perAgent: {},
      decidedAt: null,
      bootId: null,
      graceDeadline: null,
    });
  });

  it('persists each decision value, per-agent choices, and boot stamps across a fresh database handle', () => {
    const decisions: BootReconciliationDecision[] = [
      'pending',
      'resume_all',
      'hold_all',
      'per_agent',
    ];
    const perAgent = {
      'PAN-2076': 'resume',
      'PAN-2075': 'hold',
    } as const;

    stampBootReconciliation('boot-123', '2026-06-29T15:30:00.000Z');
    for (const decision of decisions) {
      setBootReconciliationDecision(decision, decision === 'per_agent' ? perAgent : undefined);
    }

    expect(getSetting(BOOT_RECONCILIATION_BOOT_ID_KEY)).toBe('boot-123');
    expect(getSetting(BOOT_RECONCILIATION_GRACE_DEADLINE_KEY)).toBe('2026-06-29T15:30:00.000Z');
    expect(getSetting(BOOT_RECONCILIATION_DECISION_KEY)).toBe('per_agent');
    expect(getSetting(BOOT_RECONCILIATION_PER_AGENT_KEY)).toBe(JSON.stringify(perAgent));
    expect(getSetting(BOOT_RECONCILIATION_DECIDED_AT_KEY)).toEqual(expect.any(String));

    resetDatabase();

    const state = getBootReconciliationState();
    expect(state).toEqual({
      decision: 'per_agent',
      perAgent,
      decidedAt: expect.any(String),
      bootId: 'boot-123',
      graceDeadline: '2026-06-29T15:30:00.000Z',
    });
    expect(Date.parse(state.decidedAt ?? '')).not.toBeNaN();
  });
});

describe('merge train app settings', () => {
  it('defaults to false on an empty database', () => {
    expect(isMergeTrainEnabled()).toBe(false);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBeNull();
  });

  it('reads the new key when set', () => {
    setMergeTrainEnabled(true);
    expect(isMergeTrainEnabled()).toBe(true);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBe('true');
    expect(getSetting(LEGACY_FLYWHEEL_MERGE_TRAIN_ENABLED_KEY)).toBeNull();
  });

  it('falls back to legacy key when new key is absent', () => {
    setSetting(LEGACY_FLYWHEEL_MERGE_TRAIN_ENABLED_KEY, 'true');
    expect(isMergeTrainEnabled()).toBe(true);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBeNull();
  });

  it('prefers new key over legacy key when both are set', () => {
    setSetting(LEGACY_FLYWHEEL_MERGE_TRAIN_ENABLED_KEY, 'true');
    setMergeTrainEnabled(false);
    expect(isMergeTrainEnabled()).toBe(false);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBe('false');
    expect(getSetting(LEGACY_FLYWHEEL_MERGE_TRAIN_ENABLED_KEY)).toBe('true');
  });

  it('round-trips the merge train flag', () => {
    setMergeTrainEnabled(true);
    expect(isMergeTrainEnabled()).toBe(true);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBe('true');

    setMergeTrainEnabled(false);
    expect(isMergeTrainEnabled()).toBe(false);
    expect(getSetting(MERGE_TRAIN_ENABLED_KEY)).toBe('false');
  });
});
