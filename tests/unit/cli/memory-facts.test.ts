import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

import { readMemoryFactsSync } from '../../../src/lib/memory/facts/store.js';
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
