import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  getProjectSync,
  PROJECTS_CONFIG_FILE,
  saveProjectsConfigSync,
  type ReleaseConfig,
} from '../../../src/lib/projects.js';
import { OVERDECK_HOME } from '../../../src/lib/paths.js';

function writeProjectsYaml(yaml: string): void {
  mkdirSync(OVERDECK_HOME, { recursive: true });
  saveProjectsConfigSync({ projects: {} });
  writeFileSync(PROJECTS_CONFIG_FILE, yaml, 'utf-8');
}

describe('project release config parsing', () => {
  beforeEach(() => {
    mkdirSync(OVERDECK_HOME, { recursive: true });
    saveProjectsConfigSync({ projects: {} });
  });

  afterEach(() => {
    rmSync(PROJECTS_CONFIG_FILE, { force: true });
  });

  it('preserves release component fields from projects.yaml', () => {
    writeProjectsYaml(`
projects:
  app:
    name: App
    path: /repo/app
    release:
      components:
        api:
          provider: render
          trigger: auto
          depends_on: [database]
          health_url: https://api.example.com/health
          version_check: npm run version:api
          smoke_test: npm run smoke:api
          rollback: npm run rollback:api
`);

    const release = getProjectSync('app')?.release;

    expect(release).toEqual({
      components: {
        api: {
          provider: 'render',
          trigger: 'auto',
          depends_on: ['database'],
          health_url: 'https://api.example.com/health',
          version_check: 'npm run version:api',
          smoke_test: 'npm run smoke:api',
          rollback: 'npm run rollback:api',
        },
      },
    } satisfies ReleaseConfig);
  });

  it('leaves release undefined when the section is absent', () => {
    writeProjectsYaml(`
projects:
  app:
    name: App
    path: /repo/app
`);

    expect(getProjectSync('app')?.release).toBeUndefined();
  });

  it('parses the MYN-shaped release fixture', () => {
    writeProjectsYaml(`
projects:
  myn:
    name: Mind Your Now
    path: /repo/myn
    release:
      components:
        api:
          trigger: auto
        frontend:
          trigger: manual
          depends_on:
            - api
        docs:
          trigger: skip
`);

    const release = getProjectSync('myn')?.release;

    expect(release?.components.frontend.depends_on).toEqual(['api']);
    expect(release?.components.docs.trigger).toBe('skip');
  });
});
