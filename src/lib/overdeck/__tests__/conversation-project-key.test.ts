import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when projects.ts loads, so set it before the first
// dynamic import of the project and conversation modules.
const TEST_HOME = join(tmpdir(), `project-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const ROOT_PATH = join(TEST_HOME, 'projects', 'root');
const NESTED_PATH = join(ROOT_PATH, 'packages', 'nested');

const { getOverdeckDatabaseSync, closeOverdeckDatabaseSync } = await import('../infra.js');
const { createConversation, getConversationByName, setConversationProjectKey } = await import('../conversations.js');
const { resolveRegisteredProject } = await import('../conversation-runtime.js');
const { resolveProjectKeyForCwdAsync } = await import('../../projects.js');

beforeAll(() => {
  mkdirSync(NESTED_PATH, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    [
      'projects:',
      '  root-key:',
      '    name: Root Project',
      `    path: ${ROOT_PATH}`,
      '  nested-key:',
      '    name: Nested Project',
      `    path: ${NESTED_PATH}`,
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  closeOverdeckDatabaseSync();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('conversation project association (PAN-3419)', () => {
  it('adds a nullable project_key column to conversations', () => {
    const columns = getOverdeckDatabaseSync()
      .prepare('PRAGMA table_info(conversations)')
      .all() as Array<{ name: string; notnull: number }>;

    expect(columns).toContainEqual(expect.objectContaining({ name: 'project_key', notnull: 0 }));
  });

  it('resolves yaml keys and display names to one canonical project record', async () => {
    await expect(resolveRegisteredProject('root-key')).resolves.toEqual(expect.objectContaining({
      key: 'root-key',
      config: expect.objectContaining({ name: 'Root Project', path: ROOT_PATH }),
    }));
    await expect(resolveRegisteredProject('Root Project')).resolves.toEqual(expect.objectContaining({
      key: 'root-key',
      config: expect.objectContaining({ name: 'Root Project', path: ROOT_PATH }),
    }));
    await expect(resolveRegisteredProject('missing')).resolves.toEqual({ error: 'Unknown project: missing' });
  });

  it('persists and updates an explicit project association through the conversation write door', async () => {
    const resolved = await resolveRegisteredProject('Nested Project');
    if ('error' in resolved) throw new Error(resolved.error);

    createConversation({
      name: 'project-associated',
      tmuxSession: 'conv-project-associated',
      cwd: join(TEST_HOME, 'isolated-worktree'),
      projectKey: resolved.key,
    });
    expect(getConversationByName('project-associated')?.projectKey).toBe('nested-key');

    setConversationProjectKey('project-associated', 'root-key');
    expect(getConversationByName('project-associated')?.projectKey).toBe('root-key');

    setConversationProjectKey('project-associated', null);
    expect(getConversationByName('project-associated')?.projectKey).toBeNull();
  });

  it('resolves cwd ownership asynchronously by the longest registered project path prefix', async () => {
    await expect(resolveProjectKeyForCwdAsync(join(NESTED_PATH, 'src'))).resolves.toBe('nested-key');
    await expect(resolveProjectKeyForCwdAsync(join(ROOT_PATH, 'other'))).resolves.toBe('root-key');
    await expect(resolveProjectKeyForCwdAsync(join(TEST_HOME, 'outside'))).resolves.toBeNull();
  });
});
