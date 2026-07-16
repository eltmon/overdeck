import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface DevcontainerCompose {
  services?: {
    'init-perms'?: {
      user?: string;
      command?: string;
      volumes?: string[];
    };
    init?: {
      command?: string;
      depends_on?: Record<string, { condition?: string }>;
      volumes?: string[];
    };
  };
}

function readDevcontainerTemplate(): DevcontainerCompose {
  const template = readFileSync(
    resolve(process.cwd(), 'infra/.devcontainer-template/docker-compose.devcontainer.yml.template'),
    'utf-8',
  );
  const rendered = template.replace(/{{[A-Z_]+}}/g, (placeholder) => {
    const key = placeholder.slice(2, -2);
    return key === 'PROJECTS_DIR' ? '/home/test/Projects' : `test-${key.toLowerCase()}`;
  });

  return parseYaml(rendered) as DevcontainerCompose;
}

describe('devcontainer init command', () => {
  it('repairs the node_modules volume ownership before installing dependencies', () => {
    const compose = readDevcontainerTemplate();
    const perms = compose.services?.['init-perms'];
    const init = compose.services?.init;

    expect(perms).toMatchObject({
      user: 'root',
      command: 'chown node:node /workspaces/overdeck/node_modules',
      volumes: ['container-node-modules:/workspaces/overdeck/node_modules'],
    });
    expect(init?.depends_on?.['init-perms']).toEqual({
      condition: 'service_completed_successfully',
    });
    expect(init?.volumes).toContain('test-project_path/.git:test-project_path/.git:ro');
  });

  it('skips package lifecycle scripts on both dependency install attempts', () => {
    const compose = readDevcontainerTemplate();
    const command = compose.services?.init?.command;

    expect(command).toEqual(expect.any(String));
    expect(command?.match(/bun install --ignore-scripts/g)).toHaveLength(2);
    expect(command).not.toContain('--backend=copyfile');
  });

  it('keeps the better-sqlite3 rebuild non-fatal', () => {
    const compose = readDevcontainerTemplate();
    const command = compose.services?.init?.command;

    expect(command).toEqual(expect.any(String));
    expect(command).not.toHaveLength(0);
    expect(command).toContain('npm rebuild better-sqlite3 2>&1 ||');
    expect(command).toContain('WARN: better-sqlite3 rebuild failed (dev-only transitive dep via evalite');
    expect(command).not.toContain('npm rebuild better-sqlite3 2>&1 &&');
  });
});
