import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeProjectNameForWorkspace } from '../workspace-rebuild.js';

describe('workspace rebuild', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a rendered dev script only when it declares the expected compose project name', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-workspace-rebuild-'));
    tempDirs.push(workspace);
    mkdirSync(join(workspace, '.devcontainer'), { recursive: true });
    writeFileSync(
      join(workspace, '.devcontainer', 'dev'),
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="panopticon-${FEATURE_FOLDER}"\n',
    );

    expect(composeProjectNameForWorkspace(workspace, 'PAN-1140')).toBe('panopticon-feature-pan-1140');
  });

  it('refuses a workspace-controlled compose project name mismatch', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-workspace-rebuild-'));
    tempDirs.push(workspace);
    mkdirSync(join(workspace, '.devcontainer'), { recursive: true });
    writeFileSync(
      join(workspace, '.devcontainer', 'dev'),
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="victim-project"\n',
    );

    expect(() => composeProjectNameForWorkspace(workspace, 'PAN-1140')).toThrow(
      'Refusing workspace rebuild',
    );
  });

  it('falls back to the canonical panopticon feature project name', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-workspace-rebuild-'));
    tempDirs.push(workspace);

    expect(composeProjectNameForWorkspace(workspace, 'PAN-1140')).toBe('panopticon-feature-pan-1140');
  });
});
