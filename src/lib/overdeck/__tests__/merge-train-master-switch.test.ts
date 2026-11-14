/**
 * PAN-4753 R6: the global merge-train flag is the master switch. A project
 * can only opt out; `enabled` no longer beats a global off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appSettings = vi.hoisted(() => new Map<string, string>());
vi.mock('../infra.js', () => ({
  getOverdeckDatabase: () => ({
    prepare: () => ({
      get: (key: string) => (appSettings.has(key) ? { value: appSettings.get(key) } : undefined),
    }),
  }),
}));

const { isMergeTrainEnabledForProject } = await import('../merge-sync.js');

describe('isMergeTrainEnabledForProject (master switch)', () => {
  beforeEach(() => appSettings.clear());

  it('is off everywhere when the global flag is off, even for a project set to enabled', () => {
    appSettings.set('merge_train.enabled', 'false');
    expect(isMergeTrainEnabledForProject({ merge_train: 'enabled' })).toBe(false);
    expect(isMergeTrainEnabledForProject({})).toBe(false);
  });

  it('lets a project opt out while the global flag is on', () => {
    appSettings.set('merge_train.enabled', 'true');
    expect(isMergeTrainEnabledForProject({ merge_train: 'disabled' })).toBe(false);
  });

  it('follows the global flag when the project sets nothing or enabled', () => {
    appSettings.set('merge_train.enabled', 'true');
    expect(isMergeTrainEnabledForProject({})).toBe(true);
    expect(isMergeTrainEnabledForProject(undefined)).toBe(true);
    expect(isMergeTrainEnabledForProject({ merge_train: 'enabled' })).toBe(true);
  });

  it('reads the legacy key when the new one is absent', () => {
    appSettings.set('flywheel.merge_train_enabled', 'true');
    expect(isMergeTrainEnabledForProject({})).toBe(true);
  });
});
