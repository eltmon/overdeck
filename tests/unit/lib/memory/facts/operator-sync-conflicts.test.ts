import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conflictCopyId } from '../../../../../src/lib/memory/facts/operator-sync-conflicts.js';
import { setupOperatorMemorySync, syncOperatorMemory } from '../../../../../src/lib/memory/facts/operator-sync.js';
import { renderManagedMemorySections } from '../../../../../src/lib/memory/facts/render.js';
import { MEMORY_FACT_ID, parseMemoryFact } from '../../../../../src/lib/memory/facts/store.js';

// Real git against a temp bare remote; operator stores A and B stand in for two machines.
const ISOLATED_GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...ISOLATED_GIT_ENV, GIT_TERMINAL_PROMPT: '0', OVERDECK_PAN_GIT_OP: '1' },
  });
}

function factText(description: string, body = 'Body.'): string {
  return `---\ntype: feedback\ndescription: ${description}\n---\n\n${body}\n`;
}

describe('operator memory sync conflicts (PAN-4578 D10)', () => {
  let tmpRoot: string;
  let bare: string;
  let dirA: string;
  let dirB: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-operator-sync-conflicts-'));
    for (const key of [...Object.keys(ISOLATED_GIT_ENV), 'OVERDECK_HOME']) savedEnv[key] = process.env[key];
    Object.assign(process.env, ISOLATED_GIT_ENV);
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');

    bare = join(tmpRoot, 'remote.git');
    git(tmpRoot, 'init', '-q', '--bare', bare);
    dirA = join(tmpRoot, 'a', 'context', 'memory');
    dirB = join(tmpRoot, 'b', 'context', 'memory');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeFact(dir: string, id: string, text: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), text, 'utf8');
  }

  const syncA = () => syncOperatorMemory({ dir: dirA, label: 'alpha' });
  const syncB = () => syncOperatorMemory({ dir: dirB, label: 'beta' });

  /** Both machines set up with one shared fact, then A edits it and syncs while B edits it locally. */
  async function divergeShared(bText: string): Promise<void> {
    writeFact(dirA, 'shared', factText('Original.'));
    await setupOperatorMemorySync(bare, { dir: dirA, machineDir: join(tmpRoot, 'a-machine'), label: 'alpha' });
    await setupOperatorMemorySync(bare, { dir: dirB, machineDir: join(tmpRoot, 'b-machine'), label: 'beta' });
    writeFact(dirA, 'shared', factText('Edited on A.'));
    await syncA();
    writeFileSync(join(dirB, 'shared.md'), bText, 'utf8');
  }

  it('modify/modify keeps theirs under the id and writes <id>-conflict-<slug> with review sync-conflict', async () => {
    await divergeShared(factText('Edited on B.'));

    const outcome = await syncB();
    expect(outcome).toMatchObject({ status: 'synced', conflicts: ['shared-conflict-beta'] });
    expect(readFileSync(join(dirB, 'shared.md'), 'utf8')).toBe(factText('Edited on A.'));

    const copyFile = join(dirB, 'shared-conflict-beta.md');
    const copy = parseMemoryFact(copyFile, readFileSync(copyFile, 'utf8'), 'user');
    expect('reason' in copy).toBe(false);
    if ('reason' in copy) return;
    expect(copy.review).toEqual(['sync-conflict']);
    expect(copy.source).toBe('sync-conflict:shared');
    expect(copy.description).toBe('Edited on B.');
    expect(copy.body).toBe('Body.');
    expect(git(dirB, 'status', '--porcelain').trim()).toBe('');
  });

  it('the conflict copy is pushed and B sees it after sync', async () => {
    await divergeShared(factText('Edited on B.'));
    await syncB();

    expect(git(bare, 'show', 'main:shared-conflict-beta.md')).toContain('Edited on B.');
    const back = await syncA();
    expect(back).toMatchObject({ status: 'synced', pulled: ['shared-conflict-beta.md'], conflicts: [] });
    expect(readFileSync(join(dirA, 'shared-conflict-beta.md'), 'utf8')).toContain('Edited on B.');
    expect(readFileSync(join(dirA, 'shared.md'), 'utf8')).toBe(factText('Edited on A.'));
  });

  it('modify/delete keeps the edited file when the remote deleted it', async () => {
    writeFact(dirA, 'shared', factText('Original.'));
    await setupOperatorMemorySync(bare, { dir: dirA, machineDir: join(tmpRoot, 'a-machine'), label: 'alpha' });
    await setupOperatorMemorySync(bare, { dir: dirB, machineDir: join(tmpRoot, 'b-machine'), label: 'beta' });
    unlinkSync(join(dirA, 'shared.md'));
    await syncA();
    writeFact(dirB, 'shared', factText('Edited on B.'));

    expect(await syncB()).toMatchObject({ status: 'synced', conflicts: [], pushed: true });
    expect(readFileSync(join(dirB, 'shared.md'), 'utf8')).toBe(factText('Edited on B.'));
    await syncA();
    expect(readFileSync(join(dirA, 'shared.md'), 'utf8')).toBe(factText('Edited on B.'));
  });

  it('modify/delete keeps the edited file when this machine deleted it', async () => {
    writeFact(dirA, 'shared', factText('Original.'));
    await setupOperatorMemorySync(bare, { dir: dirA, machineDir: join(tmpRoot, 'a-machine'), label: 'alpha' });
    await setupOperatorMemorySync(bare, { dir: dirB, machineDir: join(tmpRoot, 'b-machine'), label: 'beta' });
    writeFact(dirA, 'shared', factText('Edited on A.'));
    await syncA();
    unlinkSync(join(dirB, 'shared.md'));

    expect(await syncB()).toMatchObject({ status: 'synced', conflicts: [] });
    expect(readFileSync(join(dirB, 'shared.md'), 'utf8')).toBe(factText('Edited on A.'));
    await syncA();
    expect(readFileSync(join(dirA, 'shared.md'), 'utf8')).toBe(factText('Edited on A.'));
  });

  it('conflictCopyId stays within 80 characters for a 79-character id', () => {
    const id = `a${'b'.repeat(78)}`;
    const copyId = conflictCopyId(id, 'eltmon-z790');
    expect(copyId).toHaveLength(80);
    expect(copyId.endsWith('-conflict-eltmon-z790')).toBe(true);
    expect(MEMORY_FACT_ID.test(copyId)).toBe(true);
    expect(conflictCopyId('shared', 'beta')).toBe('shared-conflict-beta');
  });

  it('an unparseable local version is copied byte for byte', async () => {
    const raw = 'no frontmatter here\n\n  trailing spaces kept  \n\n';
    await divergeShared(raw);

    expect(await syncB()).toMatchObject({ status: 'synced', conflicts: ['shared-conflict-beta'] });
    expect(readFileSync(join(dirB, 'shared-conflict-beta.md'), 'utf8')).toBe(raw);
  });

  it('the conflict copy is excluded from the launch index', async () => {
    await divergeShared(factText('Edited on B.'));
    await syncB();
    await syncA();
    expect(existsSync(join(dirA, 'shared-conflict-beta.md'))).toBe(true);

    const text = renderManagedMemorySections(null, { userDir: dirA, machineDir: join(tmpRoot, 'a-machine') });
    expect(text).toContain('feedback/shared: Edited on A.');
    expect(text).not.toContain('shared-conflict-beta');
  });
});
