/**
 * PAN-5250 WI-2: idle-stop config resolution (FR-1) and the workspace pin store (D10).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../projects.js';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));

const {
  DEFAULT_IDLE_STOP_MINUTES,
  IDLE_STOP_DISABLE_ENV,
  idleStopConfigForIssue,
  isStackPinned,
  readStackPin,
  removeStackPin,
  resolveIdleStopConfig,
  stackPinPath,
  wakeableServicesForIssue,
  workspacePathForIssue,
  writeStackPin,
} = await import('../stack-idle-config.js');

function project(idleStop: unknown): ProjectConfig {
  return { name: 'p', path: '/repo/p', workspace: { docker: { idle_stop: idleStop as never } } } as ProjectConfig;
}

describe('resolveIdleStopConfig', () => {
  it('uses the defaults for a missing project', () => {
    const config = resolveIdleStopConfig(null, {});
    expect(config.enabled).toBe(true);
    expect(config.minutes).toBe(DEFAULT_IDLE_STOP_MINUTES);
    expect([...config.services]).toEqual(['frontend', 'fe', 'dev']);
  });

  it('disables for minutes 0, an empty service list, or the env switch', () => {
    expect(resolveIdleStopConfig(project({ minutes: 0 }), {}).enabled).toBe(false);
    expect(resolveIdleStopConfig(project({ services: [] }), {}).enabled).toBe(false);
    expect(resolveIdleStopConfig(null, { [IDLE_STOP_DISABLE_ENV]: '1' }).enabled).toBe(false);
    expect(resolveIdleStopConfig(null, { [IDLE_STOP_DISABLE_ENV]: '0' }).enabled).toBe(true);
  });

  it('falls back to 20 minutes for a negative or non-numeric value', () => {
    expect(resolveIdleStopConfig(project({ minutes: -5 }), {}).minutes).toBe(20);
    expect(resolveIdleStopConfig(project({ minutes: 'x' }), {}).minutes).toBe(20);
    expect(resolveIdleStopConfig(project({ minutes: Number.POSITIVE_INFINITY }), {}).minutes).toBe(20);
    expect(resolveIdleStopConfig(project({ minutes: 45 }), {}).minutes).toBe(45);
  });

  it('drops invalid service names and keeps a non-array at the default', () => {
    expect([...resolveIdleStopConfig(project({ services: ['fe', 'bad name', ''] }), {}).services]).toEqual(['fe']);
    expect([...resolveIdleStopConfig(project({ services: 'fe' }), {}).services]).toEqual(['frontend', 'fe', 'dev']);
  });
});

describe('issue lookups', () => {
  beforeEach(() => {
    mocks.resolveProjectFromIssueSync.mockReset();
    mocks.getProjectSync.mockReset();
  });

  it('wakeable services include dev, fe and api even when the project sets services: []', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'p' });
    mocks.getProjectSync.mockReturnValue(project({ services: [] }));
    const wakeable = wakeableServicesForIssue('PAN-1');
    expect(wakeable.has('dev')).toBe(true);
    expect(wakeable.has('fe')).toBe(true);
    expect(wakeable.has('api')).toBe(true);
    expect(wakeable.has('postgres')).toBe(false);
  });

  it('wakeable services include a configured extra service', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'p' });
    mocks.getProjectSync.mockReturnValue(project({ services: ['web'] }));
    expect(wakeableServicesForIssue('PAN-1').has('web')).toBe(true);
  });

  it('returns the defaults when the project lookup throws', () => {
    mocks.resolveProjectFromIssueSync.mockImplementation(() => { throw new Error('yaml broken'); });
    expect(idleStopConfigForIssue('PAN-1').enabled).toBe(true);
    expect(workspacePathForIssue('PAN-1')).toBeNull();
  });

  it('resolves the workspace path from the project', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'p' });
    mocks.getProjectSync.mockReturnValue({ name: 'p', path: '/repo/p' });
    expect(workspacePathForIssue('PAN-7')).toBe(join('/repo/p', 'workspaces', 'feature-pan-7'));
  });
});

describe('stack pin', () => {
  let workspace: string;
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'stack-pin-')); });
  afterEach(() => { rmSync(workspace, { recursive: true, force: true }); });

  it('round-trips a pin and creates .overdeck/ when missing', () => {
    expect(existsSync(join(workspace, '.overdeck'))).toBe(false);
    expect(isStackPinned(workspace)).toBe(false);
    writeStackPin(workspace, new Date('2026-11-23T00:00:00.000Z'));
    expect(isStackPinned(workspace)).toBe(true);
    expect(readStackPin(workspace)).toEqual({ pinnedAt: '2026-11-23T00:00:00.000Z' });
    expect(removeStackPin(workspace)).toBe(true);
    expect(isStackPinned(workspace)).toBe(false);
  });

  it('treats an unparsable pin file as pinned', () => {
    mkdirSync(join(workspace, '.overdeck'));
    writeFileSync(stackPinPath(workspace), 'not json');
    expect(isStackPinned(workspace)).toBe(true);
    expect(readStackPin(workspace)).toBeNull();
  });

  it('removeStackPin on a missing pin returns false', () => {
    expect(removeStackPin(workspace)).toBe(false);
  });

  it('never creates a missing workspace directory', () => {
    const missing = join(workspace, 'gone');
    expect(() => writeStackPin(missing, new Date())).toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
