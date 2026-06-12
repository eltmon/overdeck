import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('project merge-train override config', () => {
  const originalHome = process.env.PANOPTICON_HOME;
  let testHome: string;

  beforeEach(() => {
    vi.resetModules();
    testHome = join(tmpdir(), `pan-project-merge-train-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.PANOPTICON_HOME = testHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalHome;
    rmSync(testHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it('persists and clears the merge_train project override', async () => {
    const {
      PROJECTS_CONFIG_FILE,
      getProjectSync,
      registerProjectSync,
      setProjectMergeTrainSync,
    } = await import('../../../src/lib/projects.js');

    registerProjectSync('pan', { name: 'Panopticon', path: '/repo/pan', issue_prefix: 'PAN' });

    setProjectMergeTrainSync('pan', 'enabled');
    expect(getProjectSync('pan')?.merge_train).toBe('enabled');
    expect((parseYaml(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')) as any).projects.pan.merge_train).toBe('enabled');

    setProjectMergeTrainSync('pan', 'disabled');
    expect(getProjectSync('pan')?.merge_train).toBe('disabled');
    expect((parseYaml(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')) as any).projects.pan.merge_train).toBe('disabled');

    setProjectMergeTrainSync('pan', null);
    expect(getProjectSync('pan')?.merge_train).toBeUndefined();
    expect((parseYaml(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')) as any).projects.pan).not.toHaveProperty('merge_train');
  });
});
