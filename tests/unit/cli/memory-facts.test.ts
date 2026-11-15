import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPathRef } = vi.hoisted(() => ({ projectPathRef: { current: '' } }));
vi.mock('../../../src/lib/projects.js', () => ({
  findProjectByPath: (cwd: string) =>
    cwd === projectPathRef.current || cwd.startsWith(`${projectPathRef.current}/`)
      ? { name: 'P', path: projectPathRef.current }
      : null,
  getProjectSync: (key: string) => (key === 'overdeck' ? { name: 'P', path: projectPathRef.current } : null),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
}));

const { searchMemoryMock } = vi.hoisted(() => ({ searchMemoryMock: vi.fn() }));
vi.mock('../../../src/lib/memory/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/memory/cli.js')>();
  return { ...actual, searchMemory: searchMemoryMock };
});

// PAN-5358: add/edit now refresh fact vectors best-effort by default. Mock the
// module so no test loads a real embedding model; tests of the refresh itself
// inject their own `refreshVectors` stub via command options.
vi.mock('../../../src/lib/memory/facts/vectors.js', () => ({
  refreshStoreVectorsBestEffort: vi.fn().mockResolvedValue({ ok: true, embedded: 0, reused: 0 }),
}));

import { readMemoryFactsSync } from '../../../src/lib/memory/facts/store.js';
import { renderManagedMemorySections } from '../../../src/lib/memory/facts/render.js';
import {
  memoryFactAddCommand,
  memoryFactEditCommand,
  memoryFactListCommand,
  memoryFactRetireCommand,
  memoryFactShowCommand,
  printMatchingFacts,
  resolveFactTarget,
} from '../../../src/cli/commands/memory-facts.js';
import { memorySearchCommand } from '../../../src/cli/commands/memory.js';

describe('pan memory curated-fact commands (PAN-3957)', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;
  let previousCwd: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-facts-cli-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectRoot = join(tmpRoot, 'project');
    projectPathRef.current = projectRoot;
    previousCwd = process.cwd();
    mkdirSync(projectRoot, { recursive: true });
    process.chdir(projectRoot);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitCodes = [];
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCodes.push(code ?? 0);
      throw new Error(`exit(${code ?? 0})`);
    });
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeFact(dir: string, id: string, body: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), body, 'utf8');
  }

  describe('resolveFactTarget', () => {
    it('--user resolves to the operator store with no root', () => {
      const target = resolveFactTarget({ user: true }, 'read');
      expect(target.scope).toBe('user');
      expect(target.dir).toBe(join(process.env.OVERDECK_HOME as string, 'context', 'memory'));
      expect(target.root).toBeNull();
    });

    it('--project <key> resolves to that project\'s primary checkout regardless of mode', () => {
      const target = resolveFactTarget({ project: 'overdeck' }, 'write');
      expect(target.dir).toBe(join(projectRoot, '.overdeck', 'memory'));
    });

    it('unknown --project is an error', () => {
      expect(() => resolveFactTarget({ project: 'nope' }, 'read')).toThrow('unknown project "nope"');
    });

    it('read mode without --here resolves to the primary checkout from a workspace cwd', () => {
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      mkdirSync(workspace, { recursive: true });
      process.chdir(workspace);
      const target = resolveFactTarget({}, 'read');
      expect(target.dir).toBe(join(projectRoot, '.overdeck', 'memory'));
    });

    it('read mode with --here resolves to the cwd checkout', () => {
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      mkdirSync(workspace, { recursive: true });
      process.chdir(workspace);
      const target = resolveFactTarget({ here: true }, 'read');
      expect(target.dir).toBe(join(workspace, '.overdeck', 'memory'));
    });

    it('write mode always resolves to the cwd checkout', () => {
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      mkdirSync(workspace, { recursive: true });
      process.chdir(workspace);
      const target = resolveFactTarget({}, 'write');
      expect(target.dir).toBe(join(workspace, '.overdeck', 'memory'));
    });

    it('--project and --user together is an error', () => {
      expect(() => resolveFactTarget({ project: 'overdeck', user: true }, 'read')).toThrow(
        '--project, --user, --machine and --here are mutually exclusive',
      );
    });

    it('--user and --machine together are refused', () => {
      expect(() => resolveFactTarget({ user: true, machine: true }, 'read')).toThrow(
        '--project, --user, --machine and --here are mutually exclusive',
      );
    });

    it('--machine resolves to the machine store with no root', () => {
      const target = resolveFactTarget({ machine: true }, 'write');
      expect(target.scope).toBe('machine');
      expect(target.dir).toBe(join(process.env.OVERDECK_HOME as string, 'context', 'machine-memory'));
      expect(target.root).toBeNull();
    });

    it('outside a registered project with neither flag is an error', () => {
      process.chdir(tmpRoot);
      expect(() => resolveFactTarget({}, 'read')).toThrow('not inside a registered project; pass --project <key> or --user');
    });
  });

  describe('memoryFactShowCommand', () => {
    it('show from a workspace reads the primary store', async () => {
      writeFact(
        join(projectRoot, '.overdeck', 'memory'),
        'be-decisive',
        '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n',
      );
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      mkdirSync(workspace, { recursive: true });
      process.chdir(workspace);

      await memoryFactShowCommand('be-decisive', {});

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Make routine reversible calls yourself.');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(`Source: ${join(projectRoot, '.overdeck', 'memory', 'be-decisive.md')}`);
    });

    it('show --here from a workspace reads the workspace store', async () => {
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      writeFact(
        join(workspace, '.overdeck', 'memory'),
        'workspace-only',
        '---\ntype: feedback\ndescription: Only in this workspace.\n---\nBody.\n',
      );
      process.chdir(workspace);

      await memoryFactShowCommand('workspace-only', { here: true });

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Only in this workspace.');
    });

    it('show prints Attribution, Created, Status and Supersedes lines', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(
        dir,
        'mid-rule',
        '---\ntype: project\ndescription: Mid rule.\ncreated: 2026-11-01\nsource: twitch:alice 2026-11-10 14:20\nstatus: superseded\nsupersedes:\n  - old-a\n  - old-b\nsuperseded_by: top-rule\n---\n\nBody.\n',
      );

      await memoryFactShowCommand('mid-rule', {});

      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      expect(lines.slice(0, 5)).toEqual([
        `Source: ${join(dir, 'mid-rule.md')}`,
        'Attribution: twitch:alice 2026-11-10 14:20',
        'Created: 2026-11-01',
        'Status: superseded by top-rule',
        'Supersedes: old-a, old-b',
      ]);
      expect(lines[5]).toContain('description: Mid rule.');
    });

    it('show of a plain fact prints no Attribution line', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'plain-rule', '---\ntype: project\ndescription: Plain.\n---\n\nBody.\n');

      await memoryFactShowCommand('plain-rule', {});

      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      expect(lines[0]).toBe(`Source: ${join(dir, 'plain-rule.md')}`);
      const output = lines.join('\n');
      expect(output).not.toContain('Attribution:');
      expect(output).not.toContain('Status:');
      expect(output).not.toContain('Supersedes:');
      expect(output).not.toContain('Created:');
    });

    it('errors when the fact does not exist', async () => {
      await expect(memoryFactShowCommand('missing', {})).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      expect(exitCodes).toEqual([1]);
    });
  });

  describe('memoryFactListCommand', () => {
    it('lists active facts and excludes review-marked ones by default', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'active-fact', '---\ntype: feedback\ndescription: Active one.\n---\nBody.\n');
      writeFact(dir, 'marked-fact', '---\ntype: feedback\ndescription: Marked one.\nreview: [unindexed]\n---\nBody.\n');

      await memoryFactListCommand({});

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('feedback/active-fact  Active one.');
      expect(output).not.toContain('marked-fact');
    });

    it('--review shows only marked facts', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'active-fact', '---\ntype: feedback\ndescription: Active one.\n---\nBody.\n');
      writeFact(dir, 'marked-fact', '---\ntype: feedback\ndescription: Marked one.\nreview: [unindexed]\n---\nBody.\n');

      await memoryFactListCommand({ review: true });

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('marked-fact');
      expect(output).not.toContain('active-fact');
    });

    it('list hides a superseded fact by default and shows it with --all and a [superseded by x] suffix', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'new-rule', '---\ntype: project\ndescription: New rule.\nsupersedes: [old-rule]\n---\nBody.\n');
      writeFact(dir, 'old-rule', '---\ntype: project\ndescription: Old rule.\nstatus: superseded\nsuperseded_by: new-rule\n---\nBody.\n');
      writeFact(dir, 'dead-rule', '---\ntype: project\ndescription: Dead rule.\nstatus: retired\n---\nBody.\n');

      await memoryFactListCommand({});
      const plain = logSpy.mock.calls.flat().join('\n');
      expect(plain).toContain('project/new-rule  New rule.');
      expect(plain).not.toContain('old-rule');
      expect(plain).not.toContain('dead-rule');

      logSpy.mockClear();
      await memoryFactListCommand({ all: true });
      const all = logSpy.mock.calls.flat().join('\n');
      expect(all).toContain('project/new-rule  New rule.');
      expect(all).toContain('project/old-rule  Old rule. [superseded by new-rule]');
      expect(all).toContain('project/dead-rule  Dead rule. [retired]');
    });

    it('list --review shows only review-marked facts, not superseded ones', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'marked-fact', '---\ntype: feedback\ndescription: Marked one.\nreview: [unindexed]\n---\nBody.\n');
      writeFact(dir, 'old-rule', '---\ntype: project\ndescription: Old rule.\nstatus: superseded\nsuperseded_by: new-rule\n---\nBody.\n');

      await memoryFactListCommand({ review: true });

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('feedback/marked-fact  Marked one. [review: unindexed]');
      expect(output).not.toContain('old-rule');
    });

    it('list --review --all exits 1', async () => {
      await expect(memoryFactListCommand({ review: true, all: true })).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('--review and --all are mutually exclusive');
    });

    it('filters by --type and --query', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'fb-fact', '---\ntype: feedback\ndescription: Decide fast.\n---\nBody.\n');
      writeFact(dir, 'ref-fact', '---\ntype: reference\ndescription: Decide slow.\n---\nBody.\n');

      await memoryFactListCommand({ type: 'reference' });
      expect(logSpy.mock.calls.flat().join('\n')).toContain('ref-fact');

      logSpy.mockClear();
      await memoryFactListCommand({ query: 'fast' });
      expect(logSpy.mock.calls.flat().join('\n')).toContain('fb-fact');
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('ref-fact');
    });

    it('exits 1 and prints Problems for a malformed file', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'broken', 'not a fact file\n');

      await expect(memoryFactListCommand({})).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Problems:');
    });

    it('--json prints { scope, dir, facts, problems }', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      writeFact(dir, 'active-fact', '---\ntype: feedback\ndescription: Active one.\n---\nBody.\n');

      await memoryFactListCommand({ json: true });

      const printed = logSpy.mock.calls.map((call) => call[0]).join('');
      const parsed = JSON.parse(printed);
      expect(parsed.scope).toBe('project');
      expect(parsed.dir).toBe(dir);
      expect(parsed.facts).toHaveLength(1);
      expect(parsed.problems).toHaveLength(0);
    });
  });

  describe('memoryFactAddCommand', () => {
    function baseAddOptions(overrides: Record<string, unknown> = {}) {
      return { type: 'feedback' as const, description: 'A description.', ...overrides };
    }

    it('writes the file and prints the commit hint', async () => {
      await memoryFactAddCommand('new-fact', baseAddOptions());

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('✓ Wrote');
      expect(output).toContain('Commit it: git -C');
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.map((f) => f.id)).toEqual(['new-fact']);
    });

    it('add x --source "twitch:alice" --supersedes y writes both links and drops y from the launch index', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      await memoryFactAddCommand('old-rule', baseAddOptions({ description: 'Old arrival rule.' }));
      logSpy.mockClear();

      await memoryFactAddCommand('new-rule', baseAddOptions({
        description: 'New arrival rule.',
        source: 'twitch:alice',
        supersedes: 'old-rule',
      }));

      const today = new Date().toISOString().slice(0, 10);
      const newText = readFileSync(join(dir, 'new-rule.md'), 'utf8');
      expect(newText).toContain('source: twitch:alice');
      expect(newText).toContain(`created: ${today}`);
      expect(newText).toMatch(/supersedes:\n {2}- old-rule/);
      const oldText = readFileSync(join(dir, 'old-rule.md'), 'utf8');
      expect(oldText).toContain('status: superseded');
      expect(oldText).toContain('superseded_by: new-rule');

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain(`✓ Marked superseded ${join(dir, 'old-rule.md')}`);

      const rendered = renderManagedMemorySections(projectRoot, {
        userDir: join(tmpRoot, 'no-user'),
        machineDir: join(tmpRoot, 'no-machine'),
      });
      expect(rendered).toContain('/new-rule:');
      expect(rendered).not.toContain('/old-rule:');
    });

    it('add --supersedes missing exits 1 and writes no file', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      await expect(
        memoryFactAddCommand('new-rule', baseAddOptions({ supersedes: 'missing' })),
      ).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('no fact "missing"');
      expect(existsSync(join(dir, 'new-rule.md'))).toBe(false);
    });

    it('add prints a git add hint naming both files', async () => {
      await memoryFactAddCommand('old-rule', baseAddOptions());
      logSpy.mockClear();
      await memoryFactAddCommand('new-rule', baseAddOptions({ supersedes: 'old-rule' }));
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        `Commit it: git -C ${projectRoot} add .overdeck/memory/new-rule.md .overdeck/memory/old-rule.md`,
      );
    });

    it('add --json with --supersedes reports the superseded files', async () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      await memoryFactAddCommand('old-rule', baseAddOptions());
      logSpy.mockClear();
      await memoryFactAddCommand('new-rule', baseAddOptions({ supersedes: 'old-rule', json: true }));
      expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
        file: join(dir, 'new-rule.md'),
        superseded: [join(dir, 'old-rule.md')],
      });
    });

    it('refuses outside a registered project', async () => {
      process.chdir(tmpRoot);
      await expect(memoryFactAddCommand('new-fact', baseAddOptions())).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
    });

    it('--type user without --user is refused', async () => {
      await expect(memoryFactAddCommand('user-fact', baseAddOptions({ type: 'user' }))).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'user facts go in the operator store: add --user (or --machine for this machine only)',
      );
    });

    it('add --type user --machine is accepted', async () => {
      await memoryFactAddCommand('user-fact', baseAddOptions({ type: 'user', machine: true }));
      const dir = join(process.env.OVERDECK_HOME as string, 'context', 'machine-memory');
      expect(readMemoryFactsSync(dir, 'machine').facts.map((f) => f.type)).toEqual(['user']);
    });

    it('refuses when check-ignore reports ignored', async () => {
      await expect(
        memoryFactAddCommand('new-fact', baseAddOptions({ checkIgnored: async () => true })),
      ).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('git-ignored');
    });

    it('from a workspace writes into the workspace checkout, not the primary', async () => {
      const workspace = join(projectRoot, 'workspaces', 'feature-x');
      mkdirSync(workspace, { recursive: true });
      process.chdir(workspace);

      await memoryFactAddCommand('workspace-fact', baseAddOptions());

      expect(readMemoryFactsSync(join(workspace, '.overdeck', 'memory'), 'project').facts).toHaveLength(1);
      expect(readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project').facts).toHaveLength(0);
    });

    it('refuses a /home/<user>/ path without --user and prints the machine-specific message', async () => {
      await expect(
        memoryFactAddCommand('path-fact', baseAddOptions({ body: 'See /home/alice/notes.' })),
      ).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('machine-specific path');
    });

    it('add --user refuses a home-directory path with the --machine hint', async () => {
      await expect(
        memoryFactAddCommand('path-fact', baseAddOptions({ user: true, body: 'See /home/alice/notes.' })),
      ).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'machine-specific path "/home/alice/"; use ~ or a relative path, or keep the fact on this machine with --machine',
      );
    });

    it('add --machine writes into OVERDECK_HOME/context/machine-memory', async () => {
      await memoryFactAddCommand('path-fact', baseAddOptions({ machine: true, body: 'See /home/alice/notes.' }));
      const dir = join(process.env.OVERDECK_HOME as string, 'context', 'machine-memory');
      expect(readMemoryFactsSync(dir, 'machine').facts.map((f) => f.id)).toEqual(['path-fact']);
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Commit it:');
    });

    it('add --always writes always: true', async () => {
      await memoryFactAddCommand('always-fact', baseAddOptions({ always: true }));
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.find((f) => f.id === 'always-fact')?.always).toBe(true);
    });

    it("add refreshes the written store's vectors", async () => {
      const refreshVectors = vi.fn().mockResolvedValue({ ok: true, embedded: 1, reused: 0 });
      await memoryFactAddCommand('refreshed-fact', baseAddOptions({ refreshVectors }));

      expect(refreshVectors).toHaveBeenCalledTimes(1);
      expect(refreshVectors).toHaveBeenCalledWith({
        stores: [{ dir: join(projectRoot, '.overdeck', 'memory'), scope: 'project' }],
      });
    });

    it('add still exits 0 and prints JSON unchanged when the refresh fails', async () => {
      const refreshVectors = vi.fn().mockResolvedValue({ ok: false, reason: 'embedding provider unreachable', timedOut: false });
      await memoryFactAddCommand('refresh-failed-fact', baseAddOptions({ refreshVectors, json: true }));

      expect(exitCodes).toEqual([]);
      const output = JSON.parse(logSpy.mock.calls.flat().join('\n'));
      expect(output.file).toContain('refresh-failed-fact.md');
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'vector index not refreshed: embedding provider unreachable; run pan memory reindex',
      );
    });

    it('add exits 0 through exitCli after a refresh timeout', async () => {
      const refreshVectors = vi.fn().mockResolvedValue({ ok: false, reason: 'timed out after 30000ms', timedOut: true });
      await expect(memoryFactAddCommand('timed-out-fact', baseAddOptions({ refreshVectors }))).rejects.toThrow();

      expect(exitCodes).toEqual([0]);
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.map((f) => f.id)).toContain('timed-out-fact');
    });
  });

  describe('post-write operator sync (PAN-4578 W8)', () => {
    const userDir = () => join(process.env.OVERDECK_HOME as string, 'context', 'memory');
    const syncedOutcome = () => ({
      status: 'synced' as const,
      dir: userDir(),
      committed: true,
      pulled: [],
      pushed: true,
      conflicts: [],
      heldBack: [],
    });
    const addOptions = (overrides: Record<string, unknown>) => ({
      type: 'feedback' as const,
      description: 'A description.',
      ...overrides,
    });

    it('add --user on a synced store runs one sync', async () => {
      mkdirSync(join(userDir(), '.git'), { recursive: true });
      const syncOperator = vi.fn(async () => syncedOutcome());

      await memoryFactAddCommand('op-fact', addOptions({ user: true, syncOperator }));

      expect(syncOperator).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls.flat().join('\n')).toContain('✓ Operator memory synced (0 pulled, pushed)');
    });

    it('add --user on an unsynced store does not sync', async () => {
      const syncOperator = vi.fn(async () => syncedOutcome());
      await memoryFactAddCommand('op-fact', addOptions({ user: true, syncOperator }));
      expect(syncOperator).not.toHaveBeenCalled();
      expect(readMemoryFactsSync(userDir(), 'user').facts).toHaveLength(1);
    });

    it('add --machine never syncs', async () => {
      mkdirSync(join(userDir(), '.git'), { recursive: true });
      mkdirSync(join(process.env.OVERDECK_HOME as string, 'context', 'machine-memory', '.git'), { recursive: true });
      const syncOperator = vi.fn(async () => syncedOutcome());
      await memoryFactAddCommand('m-fact', addOptions({ machine: true, syncOperator }));
      expect(syncOperator).not.toHaveBeenCalled();
    });

    it('an offline outcome still exits 0', async () => {
      mkdirSync(join(userDir(), '.git'), { recursive: true });
      const syncOperator = vi.fn(async () => ({
        status: 'offline' as const,
        dir: userDir(),
        error: 'fetch failed: x',
        committed: true,
        heldBack: [],
      }));

      await memoryFactAddCommand('op-fact', addOptions({ user: true, syncOperator }));

      expect(exitCodes).toEqual([]);
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Operator memory sync is offline: fetch failed: x');
      expect(readMemoryFactsSync(userDir(), 'user').facts.map((f) => f.id)).toEqual(['op-fact']);
    });

    it('edit --user with an offline outcome rewrites the fact and exits 0', async () => {
      mkdirSync(join(userDir(), '.git'), { recursive: true });
      writeFact(userDir(), 'op-fact', '---\ntype: feedback\ndescription: Old.\n---\nBody.\n');
      const syncOperator = vi.fn(async () => ({
        status: 'offline' as const,
        dir: userDir(),
        error: 'fetch failed: x',
        committed: true,
        heldBack: [],
      }));

      await memoryFactEditCommand('op-fact', { user: true, description: 'd', syncOperator });

      expect(exitCodes).toEqual([]);
      expect(syncOperator).toHaveBeenCalledTimes(1);
      expect(readMemoryFactsSync(userDir(), 'user').facts[0]?.description).toBe('d');
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Operator memory sync is offline: fetch failed: x');
    });

    it('--json adds the sync outcome, and edit/retire --user sync too', async () => {
      mkdirSync(join(userDir(), '.git'), { recursive: true });
      const syncOperator = vi.fn(async () => syncedOutcome());

      await memoryFactAddCommand('op-fact', addOptions({ user: true, json: true, syncOperator }));
      expect(JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))).toEqual({
        file: join(userDir(), 'op-fact.md'),
        sync: syncedOutcome(),
      });

      await memoryFactEditCommand('op-fact', { user: true, description: 'New.', syncOperator });
      await memoryFactRetireCommand('op-fact', { user: true, syncOperator });
      expect(syncOperator).toHaveBeenCalledTimes(3);
    });
  });

  describe('memoryFactEditCommand', () => {
    const editDir = () => join(projectRoot, '.overdeck', 'memory');

    it('edit existing --supersedes other marks other superseded (the dfai case)', async () => {
      writeFact(editDir(), 'new-rule', '---\ntype: project\ndescription: New arrival rule.\n---\n\nBody.\n');
      writeFact(editDir(), 'old-rule', '---\ntype: project\ndescription: Superseded arrival rule.\n---\n\nOld body.\n');

      await memoryFactEditCommand('new-rule', { supersedes: 'old-rule' });

      const { facts } = readMemoryFactsSync(editDir(), 'project');
      const byId = Object.fromEntries(facts.map((fact) => [fact.id, fact]));
      expect(byId['new-rule'].supersedes).toEqual(['old-rule']);
      expect(byId['old-rule'].status).toBe('superseded');
      expect(byId['old-rule'].supersededBy).toBe('new-rule');
      expect(byId['old-rule'].body).toBe('Old body.');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        `Commit it: git -C ${projectRoot} add .overdeck/memory/new-rule.md .overdeck/memory/old-rule.md`,
      );
    });

    it('edit keeps created, links and unknown keys when changing only the description', async () => {
      writeFact(
        editDir(),
        'mid-rule',
        '---\ntype: project\ndescription: Mid rule.\ncreated: 2026-01-02\nsource: operator\nstatus: superseded\nsupersedes:\n  - old-rule\nsuperseded_by: top-rule\nowner: bob\nweight: 3\n---\n\nBody.\n',
      );

      await memoryFactEditCommand('mid-rule', { description: 'changed' });

      const text = readFileSync(join(editDir(), 'mid-rule.md'), 'utf8');
      const fact = readMemoryFactsSync(editDir(), 'project').facts.find((entry) => entry.id === 'mid-rule');
      if (!fact) throw new Error('mid-rule missing');
      expect(fact.description).toBe('changed');
      expect(fact.created).toBe('2026-01-02');
      expect(fact.source).toBe('operator');
      expect(fact.status).toBe('superseded');
      expect(fact.supersedes).toEqual(['old-rule']);
      expect(fact.supersededBy).toBe('top-rule');
      expect(fact.extra).toEqual({ owner: 'bob', weight: 3 });
      expect(text).toContain('owner: bob\nweight: 3\n');
    });

    it('edit --source replaces the attribution', async () => {
      writeFact(editDir(), 'some-rule', '---\ntype: project\ndescription: A rule.\nsource: twitch:alice\n---\n\nBody.\n');
      await memoryFactEditCommand('some-rule', { source: 'operator' });
      const fact = readMemoryFactsSync(editDir(), 'project').facts.find((entry) => entry.id === 'some-rule');
      expect(fact?.source).toBe('operator');
    });

    it('edit of a superseded fact with --supersedes exits 1', async () => {
      writeFact(editDir(), 'mid-rule', '---\ntype: project\ndescription: Mid.\nstatus: superseded\nsuperseded_by: top-rule\n---\n\nBody.\n');
      writeFact(editDir(), 'other-rule', '---\ntype: project\ndescription: Other.\n---\n\nBody.\n');
      const before = ['mid-rule', 'other-rule'].map((id) => readFileSync(join(editDir(), `${id}.md`), 'utf8'));

      await expect(memoryFactEditCommand('mid-rule', { supersedes: 'other-rule' })).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('"mid-rule" is superseded by "top-rule"; edit that fact instead');
      expect(['mid-rule', 'other-rule'].map((id) => readFileSync(join(editDir(), `${id}.md`), 'utf8'))).toEqual(before);
    });

    beforeEach(() => {
      writeFact(
        join(projectRoot, '.overdeck', 'memory'),
        'be-decisive',
        '---\ntype: feedback\ndescription: Original description.\ntags: [a]\n---\nOriginal body.\n',
      );
    });

    it('changes only the given fields and bumps updated', async () => {
      await memoryFactEditCommand('be-decisive', { description: 'New description.' });

      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts[0].description).toBe('New description.');
      expect(facts[0].tags).toEqual(['a']);
      expect(facts[0].updated).toBe(new Date().toISOString().slice(0, 10));
    });

    it('with no flags is refused', async () => {
      await expect(memoryFactEditCommand('be-decisive', {})).rejects.toThrow();
      expect(exitCodes).toEqual([1]);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('nothing to change');
    });

    it('--clear-review removes the review marker', async () => {
      writeFact(
        join(projectRoot, '.overdeck', 'memory'),
        'marked-fact',
        '---\ntype: feedback\ndescription: Marked.\nreview: [unindexed]\n---\nBody.\n',
      );
      await memoryFactEditCommand('marked-fact', { clearReview: true });
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.find((f) => f.id === 'marked-fact')?.review).toEqual([]);
    });

    it('edit --no-always clears the flag', async () => {
      writeFact(
        join(projectRoot, '.overdeck', 'memory'),
        'always-fact',
        '---\ntype: feedback\ndescription: Original description.\nalways: true\n---\nOriginal body.\n',
      );
      await memoryFactEditCommand('always-fact', { always: false });
      const text = readFileSync(join(projectRoot, '.overdeck', 'memory', 'always-fact.md'), 'utf8');
      expect(text).not.toContain('always');
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.find((f) => f.id === 'always-fact')?.always).toBe(false);
    });

    it('edit --always alone counts as a change', async () => {
      await memoryFactEditCommand('be-decisive', { always: true });
      const { facts } = readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project');
      expect(facts.find((f) => f.id === 'be-decisive')?.always).toBe(true);
    });

    it("edit refreshes the written store's vectors", async () => {
      const refreshVectors = vi.fn().mockResolvedValue({ ok: true, embedded: 0, reused: 1 });
      await memoryFactEditCommand('be-decisive', { description: 'Edited.', refreshVectors });

      expect(refreshVectors).toHaveBeenCalledTimes(1);
      expect(refreshVectors).toHaveBeenCalledWith({
        stores: [{ dir: join(projectRoot, '.overdeck', 'memory'), scope: 'project' }],
      });
    });
  });

  describe('memoryFactRetireCommand', () => {
    it('removes the file', async () => {
      writeFact(join(projectRoot, '.overdeck', 'memory'), 'to-remove', '---\ntype: feedback\ndescription: x.\n---\nBody.\n');

      await memoryFactRetireCommand('to-remove', {});

      expect(readMemoryFactsSync(join(projectRoot, '.overdeck', 'memory'), 'project').facts).toHaveLength(0);
      expect(logSpy.mock.calls.flat().join('\n')).toContain('✓ Removed');
      expect(logSpy.mock.calls.flat().join('\n')).toContain('docs(memory): retire to-remove');
    });
  });

  describe('printMatchingFacts / pan memory search facts-first (PAN-3957 W6)', () => {
    beforeEach(() => {
      searchMemoryMock.mockReset();
    });

    it('printMatchingFacts prints at most 5 matches per store under bold headings', () => {
      const dir = join(projectRoot, '.overdeck', 'memory');
      for (let i = 0; i < 7; i += 1) {
        writeFact(dir, `fact-${i}`, `---\ntype: feedback\ndescription: Decide fast ${i}.\n---\nBody.\n`);
      }

      printMatchingFacts('decide', {});

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Project memory:');
      const matchedLines = output.split('\n').filter((line) => line.startsWith('  feedback/fact-'));
      expect(matchedLines).toHaveLength(5);
    });

    it('search prints Machine memory after Operator memory', () => {
      const home = process.env.OVERDECK_HOME as string;
      writeFact(join(home, 'context', 'memory'), 'op-fact', '---\ntype: feedback\ndescription: Decide fast op.\n---\nBody.\n');
      writeFact(join(home, 'context', 'machine-memory'), 'gpu-fact', '---\ntype: reference\ndescription: Decide fast gpu.\n---\nBody.\n');

      printMatchingFacts('decide', {});

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('reference/gpu-fact: Decide fast gpu.');
      expect(output.indexOf('Machine memory:')).toBeGreaterThan(output.indexOf('Operator memory:'));
      expect(output.indexOf('Operator memory:')).toBeGreaterThanOrEqual(0);
    });

    it('silently skips the project store outside a registered project', () => {
      process.chdir(tmpRoot);
      expect(() => printMatchingFacts('decide', {})).not.toThrow();
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Project memory:');
    });

    it('search prints Project memory lines before observation lines', async () => {
      writeFact(
        join(projectRoot, '.overdeck', 'memory'),
        'be-decisive',
        '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n',
      );
      searchMemoryMock.mockResolvedValue([
        {
          observation: {
            issueId: 'PAN-1', timestamp: '2026-01-01T00:00:00Z', actionStatus: 'did a thing',
            summary: 's', workspaceId: 'w1', files: [],
          },
          score: 1,
        },
      ]);

      await memorySearchCommand('decisive', {});

      const lines = logSpy.mock.calls.flat();
      const projectIdx = lines.findIndex((line) => typeof line === 'string' && line.includes('Project memory:'));
      const obsIdx = lines.findIndex((line) => typeof line === 'string' && line.includes('PAN-1'));
      expect(projectIdx).toBeGreaterThanOrEqual(0);
      expect(obsIdx).toBeGreaterThan(projectIdx);
    });

    it('--json output is unchanged', async () => {
      const mockResults = [
        {
          observation: {
            issueId: 'PAN-1', timestamp: '2026-01-01T00:00:00Z', actionStatus: 'x',
            summary: 's', workspaceId: 'w1', files: [],
          },
          score: 1,
        },
      ];
      searchMemoryMock.mockResolvedValue(mockResults);

      await memorySearchCommand('decisive', { json: true });

      const printed = logSpy.mock.calls.map((call) => call[0]).join('');
      expect(JSON.parse(printed)).toEqual(mockResults);
      expect(printed).not.toContain('Project memory:');
    });
  });
});
