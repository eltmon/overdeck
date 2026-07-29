/**
 * PAN-1990 memory-state-mirror: durable memory artifacts (daily summaries,
 * pin descriptors) mirrored onto the project's overdeck-state domain through
 * the same state-door commit path (queueAutoCommit/flushAutoCommits) other
 * domain writers use. Real git work is mocked out (queueAutoCommit) — these
 * tests assert the file lands at the resolved domain path, not that a real
 * commit/push occurred.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectSync, unregisterProjectSync } from '../../../../src/lib/projects.js';
import { STATE_BRANCH_PATHS } from '../../../../src/lib/state-plane.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return { ...actual, queueAutoCommit: mockQueueAutoCommit };
});

let odb: OverdeckTestDb;
let projectRoot: string;
const PROJECT_KEY = 'state-mirror-test-project';

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-state-mirror-'));
  registerProjectSync(PROJECT_KEY, { name: 'State Mirror Test', path: projectRoot });
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
  vi.resetAllMocks();
});

describe('STATE_BRANCH_PATHS (ac1)', () => {
  it('contains memory/', () => {
    expect(STATE_BRANCH_PATHS).toContain('memory/');
  });
});

describe('mirrorDailySummary (ac1)', () => {
  it('lands a daily summary under the resolved memory domain path', async () => {
    const { mirrorDailySummary } = await import('../../../../src/lib/memory/state-mirror.js');
    await mirrorDailySummary(PROJECT_KEY, 'my-workspace', '2026-07-28', '# Daily summary\n');

    const expected = join(projectRoot, '.pan', 'memory', 'summaries', PROJECT_KEY, 'my-workspace-2026-07-28.md');
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, 'utf8')).toBe('# Daily summary\n');
  });
});

describe('mirrorPin / unmirrorPin (ac2)', () => {
  it('pin creates a descriptor in memory/pins/ and unpin deletes it', async () => {
    const { mirrorPin, unmirrorPin } = await import('../../../../src/lib/memory/state-mirror.js');
    const createdAt = 1785000000000;
    await mirrorPin(PROJECT_KEY, 'project', PROJECT_KEY, 'docs/A.md', createdAt);

    const expected = join(projectRoot, '.pan', 'memory', 'pins', `project__${PROJECT_KEY}__docs__A.md.json`);
    expect(existsSync(expected)).toBe(true);
    expect(JSON.parse(readFileSync(expected, 'utf8'))).toEqual({
      scope: 'project',
      scopeId: PROJECT_KEY,
      docPath: 'docs/A.md',
      createdAt,
    });

    await unmirrorPin(PROJECT_KEY, 'project', PROJECT_KEY, 'docs/A.md');
    expect(existsSync(expected)).toBe(false);
  });
});

describe('mirror path guard (ac3)', () => {
  it('rejects paths under observations/', async () => {
    const { writeMemoryStateMirror, MemoryMirrorRejectedError } = await import('../../../../src/lib/memory/state-mirror.js');
    await expect(writeMemoryStateMirror(PROJECT_KEY, 'observations/2026-07-28.jsonl', 'x', 'subject'))
      .rejects.toThrow(MemoryMirrorRejectedError);
  });

  it('rejects paths under pending/', async () => {
    const { writeMemoryStateMirror, MemoryMirrorRejectedError } = await import('../../../../src/lib/memory/state-mirror.js');
    await expect(writeMemoryStateMirror(PROJECT_KEY, 'pending/turn-1.json', 'x', 'subject'))
      .rejects.toThrow(MemoryMirrorRejectedError);
  });
});
