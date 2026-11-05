import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECTS_CONFIG_FILE, invalidateProjectsConfigCache, type ProjectConfig } from '../../../../src/lib/projects.js';
import {
  projectLaunchEnv,
  readProjectSecrets,
  resolveLaunchProject,
  type LaunchProject,
} from '../../../../src/lib/projects/launch-env.js';

// tests/setup/overdeck-home.ts points OVERDECK_HOME and HOME at per-worker temp dirs.
const ROOT = join(homedir(), 'pan-5061-launch-env');
const ACME_REPO = join(ROOT, 'acme');
const BETA_REPO = join(ROOT, 'beta');
const SECRETS = join(ROOT, 'secrets', 'acme.env');

function writeProjects(yaml: string): void {
  writeFileSync(PROJECTS_CONFIG_FILE, yaml);
  invalidateProjectsConfigCache();
}

function project(config: Partial<ProjectConfig>): LaunchProject {
  return { key: 'acme', config: { name: 'acme', path: ACME_REPO, ...config } };
}

function withSecretsFile(secretsFile: string): LaunchProject {
  return project({ workspace: { env: { secrets_file: secretsFile } } });
}

async function read(p: LaunchProject) {
  const warnings: string[] = [];
  const secrets = await readProjectSecrets(p, (line) => warnings.push(line));
  return { secrets, warnings };
}

beforeEach(() => {
  mkdirSync(join(ACME_REPO, 'src'), { recursive: true });
  mkdirSync(BETA_REPO, { recursive: true });
  mkdirSync(join(ROOT, 'secrets'), { recursive: true });
  writeProjects(
    `projects:\n` +
      `  acme:\n    name: acme\n    path: ${ACME_REPO}\n    issue_prefix: ACME\n` +
      `    workspace:\n      env:\n        secrets_file: ${SECRETS}\n` +
      `  beta:\n    name: beta\n    path: ${BETA_REPO}\n    issue_prefix: BETA\n`,
  );
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(PROJECTS_CONFIG_FILE, { force: true });
  invalidateProjectsConfigCache();
});

describe('resolveLaunchProject (PAN-5061 WI-2)', () => {
  it('resolves by issue prefix first, even when the cwd is in another project', async () => {
    expect((await resolveLaunchProject({ issueId: 'ACME-12', cwd: BETA_REPO }))?.key).toBe('acme');
  });

  it('falls back to cwd containment', async () => {
    expect((await resolveLaunchProject({ cwd: join(ACME_REPO, 'src') }))?.key).toBe('acme');
    expect((await resolveLaunchProject({ issueId: 'NOPE-1', cwd: BETA_REPO }))?.key).toBe('beta');
  });

  it('returns null when neither the issue nor the cwd matches', async () => {
    expect(await resolveLaunchProject({ issueId: 'NOPE-1', cwd: join(ROOT, 'elsewhere') })).toBeNull();
    expect(await resolveLaunchProject({})).toBeNull();
  });
});

describe('readProjectSecrets (PAN-5061 WI-2)', () => {
  it('returns {} without a warning when secrets_file is unset', async () => {
    expect(await read(project({}))).toEqual({ secrets: {}, warnings: [] });
  });

  it('reads an absolute dotenv file', async () => {
    writeFileSync(SECRETS, '# acme\nLINEAR_API_KEY="lin-acme-value"\nSENTRY_ORG=acme\n');
    expect(await read(withSecretsFile(SECRETS))).toEqual({
      secrets: { LINEAR_API_KEY: 'lin-acme-value', SENTRY_ORG: 'acme' },
      warnings: [],
    });
  });

  it('expands a leading ~/', async () => {
    writeFileSync(SECRETS, 'SENTRY_ORG=acme\n');
    const { secrets, warnings } = await read(withSecretsFile('~/pan-5061-launch-env/secrets/acme.env'));
    expect(warnings).toEqual([]);
    expect(secrets).toEqual({ SENTRY_ORG: 'acme' });
  });

  it('rejects a relative path', async () => {
    expect(await read(withSecretsFile('secrets/acme.env'))).toEqual({
      secrets: {},
      warnings: ['[project-env] acme: secrets_file must be an absolute or ~/ path'],
    });
  });

  it('rejects a path inside the project repository', async () => {
    const inside = join(ACME_REPO, '.env');
    writeFileSync(inside, 'SENTRY_ORG=acme\n');
    expect(await read(withSecretsFile(inside))).toEqual({
      secrets: {},
      warnings: ['[project-env] acme: secrets_file must live outside the project repository'],
    });
  });

  it('warns once for a missing file', async () => {
    expect(await read(withSecretsFile(join(ROOT, 'secrets', 'missing.env')))).toEqual({
      secrets: {},
      warnings: ['[project-env] acme: secrets_file not readable: ENOENT'],
    });
  });

  it('drops reserved keys with one warning that names keys but never values', async () => {
    writeFileSync(
      SECRETS,
      'OVERDECK_HOME=/evil-home-value\nANTHROPIC_BASE_URL=https://evil-proxy-value\nLINEAR_API_KEY=lin-secret-value\n',
    );
    const { secrets, warnings } = await read(withSecretsFile(SECRETS));
    expect(secrets).toEqual({ LINEAR_API_KEY: 'lin-secret-value' });
    expect(warnings).toEqual(['[project-env] acme: secrets_file reserved keys dropped: OVERDECK_HOME, ANTHROPIC_BASE_URL']);
    const all = warnings.join('\n');
    for (const value of ['/evil-home-value', 'evil-proxy-value', 'lin-secret-value']) expect(all).not.toContain(value);
  });
});

describe('projectLaunchEnv (PAN-5061 WI-2)', () => {
  it("gives a launch its own project's secrets and none to another project", async () => {
    writeFileSync(SECRETS, 'PAN5061_PROBE=acme-only\n');
    expect(await projectLaunchEnv({ issueId: 'ACME-1' })).toEqual({ PAN5061_PROBE: 'acme-only' });
    expect(await projectLaunchEnv({ issueId: 'BETA-1' })).toEqual({});
    expect(await projectLaunchEnv({ cwd: join(ROOT, 'elsewhere') })).toEqual({});
  });
});
