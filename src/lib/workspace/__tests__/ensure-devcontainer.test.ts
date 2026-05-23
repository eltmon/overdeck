import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  renderDevcontainerSync,
  createWorkspacePlaceholdersSync,
} from '../devcontainer-renderer.js';
import type { ProjectConfig } from '../../workspace-config.js';

function makeTmpProjectAndWorkspace(): { projectPath: string; workspacePath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pan-render-test-'));
  const projectPath = join(root, 'project');
  const workspacePath = join(root, 'project', 'workspaces', 'feature-min-1');
  const templateDir = join(projectPath, 'infra', '.devcontainer-template');
  mkdirSync(templateDir, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });

  // Minimal compose template that uses the placeholder set.
  writeFileSync(
    join(templateDir, 'docker-compose.devcontainer.yml.template'),
    'name: {{COMPOSE_PROJECT}}\nservices:\n  api:\n    image: example/{{FEATURE_FOLDER}}\n',
  );
  // Non-template file that should be copied verbatim.
  writeFileSync(join(templateDir, 'Dockerfile'), 'FROM alpine\n');
  // Dev script that should get +x and a workspace-root symlink.
  writeFileSync(
    join(templateDir, 'dev.template'),
    '#!/bin/sh\necho {{FEATURE_FOLDER}}\n',
  );

  return { projectPath, workspacePath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function buildProjectConfig(projectPath: string): ProjectConfig {
  return {
    name: 'project',
    path: projectPath,
    workspace: {
      docker: { compose_template: 'infra/.devcontainer-template' },
    },
  };
}

describe('createWorkspacePlaceholders', () => {
  it('produces the canonical placeholder set with HOME populated', () => {
    const cfg = buildProjectConfig('/tmp/x');
    const ph = createWorkspacePlaceholdersSync(cfg, 'min-846', '/tmp/x/workspaces/feature-min-846');
    expect(ph.FEATURE_NAME).toBe('min-846');
    expect(ph.FEATURE_FOLDER).toBe('feature-min-846');
    expect(ph.BRANCH_NAME).toBe('feature/min-846');
    expect(ph.PROJECT_NAME).toBe('x');
    expect(ph.WORKSPACE_PATH).toBe('/tmp/x/workspaces/feature-min-846');
    expect(ph.HOME).toBeDefined();
  });

  it('lets callers override individual placeholder fields', () => {
    const cfg = buildProjectConfig('/tmp/x');
    const ph = createWorkspacePlaceholdersSync(cfg, 'min-1', '/tmp/x/ws', { DOMAIN: 'override.test' });
    expect(ph.DOMAIN).toBe('override.test');
  });
});

describe('renderDevcontainer', () => {
  let projectPath: string;
  let workspacePath: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ projectPath, workspacePath, cleanup } = makeTmpProjectAndWorkspace());
  });

  afterEach(() => cleanup());

  it('creates .devcontainer/, processes templates, and copies non-template files', () => {
    const result = renderDevcontainerSync({
      workspacePath,
      projectConfig: buildProjectConfig(projectPath),
      featureName: 'min-1',
    });
    expect(result.devcontainerDir).toBe(join(workspacePath, '.devcontainer'));
    expect(existsSync(join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'))).toBe(true);
    expect(existsSync(join(workspacePath, '.devcontainer', 'Dockerfile'))).toBe(true);
    expect(existsSync(join(workspacePath, '.devcontainer', 'dev'))).toBe(true);
  });

  it('substitutes placeholders into rendered files', () => {
    renderDevcontainerSync({
      workspacePath,
      projectConfig: buildProjectConfig(projectPath),
      featureName: 'min-1',
    });
    const compose = readFileSync(
      join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
      'utf-8',
    );
    expect(compose).toContain('feature-min-1');
    expect(compose).not.toContain('{{FEATURE_FOLDER}}');
  });

  it('is idempotent — second render produces identical files', () => {
    renderDevcontainerSync({
      workspacePath,
      projectConfig: buildProjectConfig(projectPath),
      featureName: 'min-1',
    });
    const before = readFileSync(
      join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
      'utf-8',
    );
    renderDevcontainerSync({
      workspacePath,
      projectConfig: buildProjectConfig(projectPath),
      featureName: 'min-1',
    });
    const after = readFileSync(
      join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
      'utf-8',
    );
    expect(after).toBe(before);
  });

  it('throws when the project has no compose_template configured', () => {
    const cfg: ProjectConfig = { name: 'project', path: projectPath, workspace: {} };
    expect(() =>
      renderDevcontainerSync({ workspacePath, projectConfig: cfg, featureName: 'min-1' }),
    ).toThrow(/compose_template/);
  });
});
