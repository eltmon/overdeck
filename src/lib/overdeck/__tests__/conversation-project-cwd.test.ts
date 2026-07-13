import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Regression guard for PAN-2590: the Command Deck identifies projects by
// display name, not yaml key (registration slugifies "MyApp" → key "myapp").
// Conversation create must accept either identifier, and must distinguish
// "not registered" from "registered but path missing on disk".

// OVERDECK_HOME is resolved at module load (src/lib/paths.ts), so it must be
// set before the first dynamic import of conversation-runtime.js.
const TEST_HOME = join(tmpdir(), `proj-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const MYAPP_PATH = join(TEST_HOME, 'projects', 'myapp');

vi.setConfig({ testTimeout: 15_000 });

const { resolveProjectCwd } = await import('../conversation-runtime.js');

beforeAll(() => {
  mkdirSync(MYAPP_PATH, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    [
      'projects:',
      '  myapp:',
      '    name: MyApp',
      `    path: ${MYAPP_PATH}`,
      '  ghost:',
      '    name: Ghost',
      `    path: ${join(TEST_HOME, 'projects', 'does-not-exist')}`,
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('resolveProjectCwd', () => {
  it('resolves a project by its yaml key', async () => {
    expect(resolveProjectCwd('myapp')).toEqual({ cwd: MYAPP_PATH });
  });

  it('resolves a project by its display name (PAN-2590)', async () => {
    expect(resolveProjectCwd('MyApp')).toEqual({ cwd: MYAPP_PATH });
  });

  it('reports an unregistered project as unknown', async () => {
    expect(resolveProjectCwd('Nope')).toEqual({ error: 'Unknown project: Nope' });
  });

  it('reports a registered project whose path is missing on disk', async () => {
    const result = resolveProjectCwd('Ghost');
    expect('error' in result && result.error).toMatch(/^Project path does not exist: /);
    expect('error' in result && result.error).toContain('(project: Ghost)');
  });
});
