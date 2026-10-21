import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isOperatorMemorySynced,
  labelSlug,
  OperatorMemorySetupError,
  readOperatorMemorySyncStatus,
  redactRemoteUrl,
  setupOperatorMemorySync,
  syncOperatorMemory,
} from '../../../../../src/lib/memory/facts/operator-sync.js';

// Real git against a temp bare remote; two operator stores A and B stand in for two machines.
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

describe('operator memory sync (PAN-4578)', () => {
  let tmpRoot: string;
  let bare: string;
  let dirA: string;
  let dirB: string;
  let machineA: string;
  let machineB: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-operator-sync-'));
    for (const key of [...Object.keys(ISOLATED_GIT_ENV), 'OVERDECK_HOME']) savedEnv[key] = process.env[key];
    Object.assign(process.env, ISOLATED_GIT_ENV);
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');

    bare = join(tmpRoot, 'remote.git');
    git(tmpRoot, 'init', '-q', '--bare', bare);
    dirA = join(tmpRoot, 'a', 'context', 'memory');
    dirB = join(tmpRoot, 'b', 'context', 'memory');
    machineA = join(tmpRoot, 'a', 'context', 'machine-memory');
    machineB = join(tmpRoot, 'b', 'context', 'machine-memory');
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

  function remoteHas(path: string): boolean {
    try {
      git(bare, 'show', `main:${path}`);
      return true;
    } catch {
      return false;
    }
  }

  async function setupA() {
    return setupOperatorMemorySync(bare, { dir: dirA, machineDir: machineA, label: 'alpha' });
  }

  async function setupB() {
    return setupOperatorMemorySync(bare, { dir: dirB, machineDir: machineB, label: 'beta' });
  }

  it('not configured without .git', async () => {
    writeFact(dirA, 'be-decisive', factText('Decide.'));
    expect(isOperatorMemorySynced(dirA)).toBe(false);
    await expect(syncOperatorMemory({ dir: dirA, label: 'alpha' })).resolves.toEqual({ status: 'not-configured', dir: dirA });
  });

  it('setup on an empty remote pushes local facts to main', async () => {
    writeFact(dirA, 'be-decisive', factText('Decide.'));
    const result = await setupA();
    expect(result.outcome).toMatchObject({ status: 'synced', committed: true, pushed: true, heldBack: [] });
    expect(result.migrated).toEqual([]);
    expect(remoteHas('be-decisive.md')).toBe(true);
    expect(git(bare, 'log', '-1', '--format=%an|%s', 'main').trim()).toBe('pan memory sync (alpha)|memory: sync from alpha');
  });

  it('setup on a second machine pulls the first machine facts', async () => {
    writeFact(dirA, 'be-decisive', factText('Decide.'));
    await setupA();

    const result = await setupB();
    expect(result.outcome).toMatchObject({ status: 'synced', pulled: ['be-decisive.md'] });
    expect(readFileSync(join(dirB, 'be-decisive.md'), 'utf8')).toBe(factText('Decide.'));
  });

  it('setup on a second machine with its own facts merges both histories', async () => {
    writeFact(dirA, 'be-decisive', factText('Decide.'));
    await setupA();
    writeFact(dirB, 'terse', factText('Be terse.'));

    const result = await setupB();
    expect(result.outcome).toMatchObject({ status: 'synced', pulled: ['be-decisive.md'], pushed: true });
    expect(remoteHas('terse.md')).toBe(true);

    const back = await syncOperatorMemory({ dir: dirA, label: 'alpha' });
    expect(back).toMatchObject({ status: 'synced', pulled: ['terse.md'] });
    expect(existsSync(join(dirA, 'terse.md'))).toBe(true);
  });

  it('a fact added on A reaches B after both sync', async () => {
    await setupA();
    await setupB();
    writeFact(dirA, 'new-fact', factText('Fresh.'));

    expect(await syncOperatorMemory({ dir: dirA, label: 'alpha' })).toMatchObject({ status: 'synced', committed: true, pushed: true });
    expect(await syncOperatorMemory({ dir: dirB, label: 'beta' })).toMatchObject({ status: 'synced', pulled: ['new-fact.md'] });
    expect(readFileSync(join(dirB, 'new-fact.md'), 'utf8')).toBe(factText('Fresh.'));
  });

  it('a retire on A deletes the file on B', async () => {
    writeFact(dirA, 'old-fact', factText('Old.'));
    await setupA();
    await setupB();
    expect(existsSync(join(dirB, 'old-fact.md'))).toBe(true);

    unlinkSync(join(dirA, 'old-fact.md'));
    expect(await syncOperatorMemory({ dir: dirA, label: 'alpha' })).toMatchObject({ status: 'synced', pushed: true });
    expect(await syncOperatorMemory({ dir: dirB, label: 'beta' })).toMatchObject({ status: 'synced', pulled: ['old-fact.md'] });
    expect(existsSync(join(dirB, 'old-fact.md'))).toBe(false);
  });

  it('setup with an unreachable remote throws and changes nothing', async () => {
    writeFact(dirA, 'gpu', factText('GPU.', 'See /home/alice/gpu.'));
    writeFact(dirA, 'be-decisive', factText('Decide.'));

    const setup = setupOperatorMemorySync('file:///nonexistent/x.git', { dir: dirA, machineDir: machineA, label: 'alpha' });
    await expect(setup).rejects.toBeInstanceOf(OperatorMemorySetupError);
    await expect(setup).rejects.toThrow(/^cannot reach file:\/\/\/nonexistent\/x\.git: /);
    expect(existsSync(join(dirA, '.git'))).toBe(false);
    expect(existsSync(join(dirA, 'gpu.md'))).toBe(true);
    expect(existsSync(machineA)).toBe(false);
  });

  it('setup migrates a home-path operator fact to the machine store', async () => {
    writeFact(dirA, 'gpu', factText('GPU.', 'See /home/alice/gpu.'));
    writeFact(dirA, 'be-decisive', factText('Decide.'));

    const result = await setupA();
    expect(result.migrated).toEqual([{ id: 'gpu', to: join(machineA, 'gpu.md') }]);
    expect(result.kept).toEqual([]);
    expect(existsSync(join(dirA, 'gpu.md'))).toBe(false);
    expect(readFileSync(join(machineA, 'gpu.md'), 'utf8')).toContain('/home/alice/gpu');
    expect(remoteHas('gpu.md')).toBe(false);
    expect(remoteHas('be-decisive.md')).toBe(true);
  });

  it('setup keeps a home-path fact whose machine-store slot is taken, and holds it back', async () => {
    writeFact(dirA, 'gpu', factText('GPU.', 'See /home/alice/gpu.'));
    writeFact(machineA, 'gpu', factText('Existing GPU.'));

    const result = await setupA();
    expect(result.migrated).toEqual([]);
    expect(result.kept).toEqual(['gpu']);
    expect(result.outcome).toMatchObject({ status: 'synced', heldBack: [{ path: 'gpu.md', reason: 'machine-specific path' }] });
    expect(remoteHas('gpu.md')).toBe(false);
  });

  it('a secret-like file is held back and never reaches the remote', async () => {
    await setupA();
    // Built at runtime so no literal token-shaped fixture lands in the repository.
    writeFact(dirA, 'secret-key', factText('Key.', `Key is ${['sk', 'ant', 'abcdef1234567890'].join('-')}.`));
    writeFact(dirA, 'clean', factText('Clean.'));

    const outcome = await syncOperatorMemory({ dir: dirA, label: 'alpha' });
    expect(outcome).toMatchObject({
      status: 'synced',
      committed: true,
      heldBack: [{ path: 'secret-key.md', reason: 'secret-like content' }],
    });
    expect(remoteHas('secret-key.md')).toBe(false);
    expect(remoteHas('clean.md')).toBe(true);
    expect(existsSync(join(dirA, 'secret-key.md'))).toBe(true);
  });

  it('a home-path file added by hand is held back', async () => {
    await setupA();
    writeFact(dirA, 'local-path', factText('Path.', 'Lives in /home/alice/notes.'));

    const outcome = await syncOperatorMemory({ dir: dirA, label: 'alpha' });
    expect(outcome).toMatchObject({
      status: 'synced',
      committed: false,
      heldBack: [{ path: 'local-path.md', reason: 'machine-specific path' }],
    });
    expect(remoteHas('local-path.md')).toBe(false);
  });

  it('offline fetch returns offline and keeps the local commit', async () => {
    await setupA();
    const gone = join(tmpRoot, 'gone.git');
    git(tmpRoot, 'init', '-q', '--bare', gone);
    git(dirA, 'remote', 'set-url', 'origin', gone);
    rmSync(gone, { recursive: true, force: true });
    writeFact(dirA, 'offline-fact', factText('Offline.'));

    const outcome = await syncOperatorMemory({ dir: dirA, label: 'alpha' });
    expect(outcome).toMatchObject({ status: 'offline', committed: true, heldBack: [] });
    expect(outcome.status === 'offline' ? outcome.error : '').toMatch(/^fetch failed: /);
    expect(git(dirA, 'log', '-1', '--format=%s').trim()).toBe('memory: sync from alpha');
    expect(git(dirA, 'ls-files').split('\n')).toContain('offline-fact.md');
  });

  it('setup with a different url than the existing origin throws', async () => {
    await setupA();
    const other = join(tmpRoot, 'other.git');
    git(tmpRoot, 'init', '-q', '--bare', other);

    await expect(
      setupOperatorMemorySync(other, { dir: dirA, machineDir: machineA, label: 'alpha' }),
    ).rejects.toThrow(`already synced with ${bare}; to switch, run git -C ${dirA} remote set-url origin <url>`);
    expect(git(dirA, 'remote', 'get-url', 'origin').trim()).toBe(bare);
  });

  it('setup with the same url again is idempotent', async () => {
    writeFact(dirA, 'be-decisive', factText('Decide.'));
    await setupA();
    const again = await setupA();
    expect(again.outcome).toMatchObject({ status: 'synced', committed: false, pushed: false });
  });

  it('redactRemoteUrl strips userinfo', () => {
    expect(redactRemoteUrl('https://user:token123@github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(redactRemoteUrl('ssh://git@example.com/o/r.git')).toBe('ssh://example.com/o/r.git');
    expect(redactRemoteUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(redactRemoteUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
  });

  it('labelSlug lower-cases, collapses separators, caps at 24 and falls back to machine', () => {
    expect(labelSlug('eltmon-z790')).toBe('eltmon-z790');
    expect(labelSlug('  My Laptop.local ')).toBe('my-laptop-local');
    expect(labelSlug('x'.repeat(40))).toBe('x'.repeat(24));
    expect(labelSlug('***')).toBe('machine');
  });

  it('status reports ahead/behind without network', async () => {
    expect(await readOperatorMemorySyncStatus({ dir: dirA })).toMatchObject({ configured: false, remote: null, ahead: 0, behind: 0 });

    await setupA();
    await setupB();
    writeFact(dirA, 'from-a', factText('From A.'));
    await syncOperatorMemory({ dir: dirA, label: 'alpha' });

    // B fetches by hand (status itself never fetches), commits locally, and leaves one file uncommitted.
    git(dirB, 'fetch', '-q', 'origin');
    writeFact(dirB, 'from-b', factText('From B.'));
    git(dirB, 'add', 'from-b.md');
    git(dirB, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'local');
    writeFact(dirB, 'loose', factText('Loose.'));

    const status = await readOperatorMemorySyncStatus({ dir: dirB });
    expect(status).toMatchObject({ configured: true, dir: dirB, remote: bare, ahead: 1, behind: 1, uncommitted: 1, conflicts: [] });
    expect(status.lastCommit?.subject).toBe('local');
  });

  it('a conflicting edit aborts the merge and returns failed with nothing changed', async () => {
    writeFact(dirA, 'shared', factText('Original.'));
    await setupA();
    await setupB();

    writeFact(dirA, 'shared', factText('Edited on A.'));
    await syncOperatorMemory({ dir: dirA, label: 'alpha' });
    writeFact(dirB, 'shared', factText('Edited on B.'));

    const outcome = await syncOperatorMemory({ dir: dirB, label: 'beta' });
    expect(outcome).toEqual({ status: 'failed', dir: dirB, error: 'merge conflict in shared.md; nothing was changed' });
    expect(readFileSync(join(dirB, 'shared.md'), 'utf8')).toBe(factText('Edited on B.'));
    expect(existsSync(join(dirB, '.git', 'MERGE_HEAD'))).toBe(false);
  });
});
