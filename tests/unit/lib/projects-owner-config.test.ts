import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getProjectSync,
  loadProjectsConfigSync,
  PROJECTS_CONFIG_FILE,
  saveProjectsConfig,
} from '../../../src/lib/projects.js';
import { OVERDECK_HOME } from '../../../src/lib/paths.js';

// PAN-5161: projects.yaml `owner` is the sidebar's owner group label.
describe('project owner config', () => {
  beforeEach(() => {
    mkdirSync(OVERDECK_HOME, { recursive: true });
    saveProjectsConfig({ projects: {} });
  });

  afterEach(() => {
    rmSync(PROJECTS_CONFIG_FILE, { force: true });
  });

  it('reads owner from projects.yaml and writes it back unchanged', () => {
    writeFileSync(PROJECTS_CONFIG_FILE, `
projects:
  mind-your-now:
    name: Mind Your Now
    path: /repo/myn
    gitlab_repo: eltmon/mind-your-now
    owner: mindyournow
`, 'utf-8');

    expect(getProjectSync('mind-your-now')?.owner).toBe('mindyournow');

    saveProjectsConfig(loadProjectsConfigSync());

    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toContain('owner: mindyournow');
    expect(getProjectSync('mind-your-now')).toMatchObject({
      gitlab_repo: 'eltmon/mind-your-now',
      owner: 'mindyournow',
    });
  });

  it('leaves owner undefined when the field is absent', () => {
    writeFileSync(PROJECTS_CONFIG_FILE, `
projects:
  app:
    name: App
    path: /repo/app
`, 'utf-8');

    expect(getProjectSync('app')?.owner).toBeUndefined();
  });
});
