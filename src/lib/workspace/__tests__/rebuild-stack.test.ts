import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { composeProjectNameForWorkspace } from '../rebuild-stack.js';

let tmpRoot: string | null = null;

function makeWorkspace(devScript: string | null): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-rebuild-stack-'));
  const workspacePath = join(tmpRoot, 'feature-min-831');
  const devcontainerPath = join(workspacePath, '.devcontainer');
  mkdirSync(devcontainerPath, { recursive: true });
  if (devScript !== null) {
    writeFileSync(join(devcontainerPath, 'dev'), devScript);
  }
  return workspacePath;
}

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe('composeProjectNameForWorkspace', () => {
  it('uses a project-specific compose prefix declared by the workspace dev script', () => {
    const workspacePath = makeWorkspace('FEATURE_FOLDER="feature-min-831"\nexport COMPOSE_PROJECT_NAME="myn-${FEATURE_FOLDER}"\n');

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-831')).toBe('myn-feature-min-831');
  });

  it('falls back to the legacy overdeck compose prefix when no dev script declares one', () => {
    const workspacePath = makeWorkspace(null);

    expect(composeProjectNameForWorkspace(workspacePath, 'PAN-1140')).toBe('overdeck-feature-pan-1140');
  });

  it('refuses a compose project name that does not target the workspace feature folder', () => {
    const workspacePath = makeWorkspace('export COMPOSE_PROJECT_NAME="victim-project"\n');

    expect(() => composeProjectNameForWorkspace(workspacePath, 'MIN-831')).toThrow(
      'declares COMPOSE_PROJECT_NAME=victim-project, expected a name ending in feature-min-831',
    );
  });
});
