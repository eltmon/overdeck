import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `fork-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const SOURCE_PATH = join(TEST_HOME, 'projects', 'source');
const OVERRIDE_PATH = join(TEST_HOME, 'projects', 'override');

const { resolveForkProjectKey } = await import('../conversation-forks.js');

beforeAll(() => {
  mkdirSync(SOURCE_PATH, { recursive: true });
  mkdirSync(OVERRIDE_PATH, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    [
      'projects:',
      '  source-key:',
      '    name: Source Project',
      `    path: ${SOURCE_PATH}`,
      '  override-key:',
      '    name: Override Project',
      `    path: ${OVERRIDE_PATH}`,
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('summary-fork project resolution (PAN-3419)', () => {
  it('inherits an explicit project association from the source conversation', async () => {
    await expect(resolveForkProjectKey(undefined, {
      projectKey: 'source-key',
      cwd: join(TEST_HOME, 'isolated-source'),
    })).resolves.toEqual({ projectKey: 'source-key' });
  });

  it('falls back to the project owning the source cwd', async () => {
    await expect(resolveForkProjectKey(undefined, {
      projectKey: null,
      cwd: join(SOURCE_PATH, 'workspaces', 'feature-min-930'),
    })).resolves.toEqual({ projectKey: 'source-key' });
  });

  it('lets an explicit yaml key override the inherited project', async () => {
    await expect(resolveForkProjectKey('override-key', {
      projectKey: 'source-key',
      cwd: SOURCE_PATH,
    })).resolves.toEqual({ projectKey: 'override-key' });
  });

  it('resolves an explicit display name to its canonical yaml key', async () => {
    await expect(resolveForkProjectKey('Override Project', {
      projectKey: 'source-key',
      cwd: SOURCE_PATH,
    })).resolves.toEqual({ projectKey: 'override-key' });
  });

  it('returns a clear error for an unknown explicit project', async () => {
    await expect(resolveForkProjectKey('Missing Project', {
      projectKey: 'source-key',
      cwd: SOURCE_PATH,
    })).resolves.toEqual({ error: 'Unknown project: Missing Project' });
  });

  it('returns no association when the source is unscoped', async () => {
    await expect(resolveForkProjectKey(undefined, {
      projectKey: null,
      cwd: join(TEST_HOME, 'outside'),
    })).resolves.toEqual({ projectKey: undefined });
  });
});
