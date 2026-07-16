import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface DevcontainerCompose {
  services?: {
    init?: {
      command?: string;
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
  it('skips package lifecycle scripts on both dependency install attempts', () => {
    const compose = readDevcontainerTemplate();
    const command = compose.services?.init?.command;

    expect(command).toEqual(expect.any(String));
    expect(command?.match(/bun install --ignore-scripts/g)).toHaveLength(2);
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
