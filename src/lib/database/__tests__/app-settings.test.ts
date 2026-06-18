import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY,
  FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY,
  getSetting,
  isFlywheelAutoPickupBacklog,
  isFlywheelRequireUatBeforeMerge,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
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
