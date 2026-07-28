import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  composeProjectNameForWorkspace,
  requireComposeProjectNameForWorkspace,
} from '../../../../src/lib/workspace/stack-health.js';
import { renderDevcontainerSync } from '../../../../src/lib/workspace/devcontainer-renderer.js';
import type { ProjectConfig } from '../../../../src/lib/workspace-config.js';

let tmpRoot: string | null = null;

function makeWorkspace(opts: { devScript?: string; composeFile?: string }): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-stack-health-compose-name-'));
  const workspacePath = join(tmpRoot, 'workspaces', 'feature-min-901');
  const devcontainerPath = join(workspacePath, '.devcontainer');
  mkdirSync(devcontainerPath, { recursive: true });
  if (opts.devScript !== undefined) {
    writeFileSync(join(devcontainerPath, 'dev'), opts.devScript);
  }
  if (opts.composeFile !== undefined) {
    writeFileSync(join(devcontainerPath, 'docker-compose.devcontainer.yml'), opts.composeFile);
  }
  return workspacePath;
}

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe('composeProjectNameForWorkspace — compose `name:` declaration', () => {
  it('prefers the dev-script declaration over the compose file name', () => {
    const workspacePath = makeWorkspace({
      devScript: 'FEATURE_FOLDER="feature-min-901"\nexport COMPOSE_PROJECT_NAME="myn-${FEATURE_FOLDER}"\n',
      composeFile: 'name: some-other-name-feature-min-901\nservices:\n  api:\n    image: test\n',
    });

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('myn-feature-min-901');
  });

  it('uses the compose file `name:` when no dev script declares one', () => {
    const workspacePath = makeWorkspace({
      composeFile: 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n',
    });

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('myn-feature-min-901');
  });

  it('refuses a compose file name that does not target the workspace feature folder', () => {
    const workspacePath = makeWorkspace({
      composeFile: 'name: victim-project\nservices:\n  api:\n    image: test\n',
    });

    expect(() => composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toThrow(
      'declares name=victim-project, expected a name ending in feature-min-901',
    );
  });

  it('falls back to the overdeck prefix when no compose file exists', () => {
    const workspacePath = makeWorkspace({});

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('overdeck-feature-min-901');
  });
});

describe('requireComposeProjectNameForWorkspace', () => {
  it('returns the compose file name when declared', () => {
    const workspacePath = makeWorkspace({
      composeFile: 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n',
    });

    expect(requireComposeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('myn-feature-min-901');
  });

  it('throws when a compose file exists but declares no name and no dev script declares one', () => {
    const workspacePath = makeWorkspace({
      composeFile: 'services:\n  api:\n    image: test\n',
    });

    expect(() => requireComposeProjectNameForWorkspace(workspacePath, 'MIN-901')).toThrow(
      /Cannot resolve compose project name for workspace .*docker-compose\.devcontainer\.yml.*\.devcontainer.*dev.*dev/s,
    );
  });

  it('falls back to the overdeck prefix without throwing when no compose file exists at all', () => {
    const workspacePath = makeWorkspace({});

    expect(requireComposeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('overdeck-feature-min-901');
  });

  it('throws the same mismatch error as the lenient variant', () => {
    const workspacePath = makeWorkspace({
      composeFile: 'name: victim-project\nservices:\n  api:\n    image: test\n',
    });

    expect(() => requireComposeProjectNameForWorkspace(workspacePath, 'MIN-901')).toThrow(
      'declares name=victim-project, expected a name ending in feature-min-901',
    );
  });
});

describe('the real Overdeck devcontainer template declares a compose `name:` (PAN-3049)', () => {
  function renderOverdeckTemplate(workspacePath: string, featureName: string): void {
    const projectConfig: ProjectConfig = {
      name: 'overdeck',
      path: join(__dirname, '../../../..'),
      workspace: { docker: { compose_template: 'infra/.devcontainer-template' } },
    };
    renderDevcontainerSync({ workspacePath, projectConfig, featureName });
  }

  it('ac1: resolves overdeck-feature-<issue> from the rendered compose file alone (no dev script)', () => {
    const workspacePath = makeWorkspace({});
    renderOverdeckTemplate(workspacePath, 'min-901');
    unlinkSync(join(workspacePath, '.devcontainer', 'dev'));

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('overdeck-feature-min-901');
  });

  it('ac2: with the dev script present, both sources agree on overdeck-feature-<issue>', () => {
    const workspacePath = makeWorkspace({});
    renderOverdeckTemplate(workspacePath, 'min-901');

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('overdeck-feature-min-901');
    expect(requireComposeProjectNameForWorkspace(workspacePath, 'MIN-901')).toBe('overdeck-feature-min-901');
  });
});
