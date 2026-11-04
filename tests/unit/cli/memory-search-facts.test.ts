import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPathRef } = vi.hoisted(() => ({ projectPathRef: { current: '' } }));
vi.mock('../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/projects.js')>();
  return {
    ...actual,
    findProjectByPath: (cwd: string) =>
      cwd === projectPathRef.current || cwd.startsWith(`${projectPathRef.current}/`)
        ? { name: 'P', path: projectPathRef.current }
        : null,
    getProjectSync: (key: string) => (key === 'overdeck' ? { name: 'P', path: projectPathRef.current } : null),
    resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
    resolveProjectKeyForCwdAsync: async (cwd: string) =>
      cwd === projectPathRef.current || cwd.startsWith(`${projectPathRef.current}/`) ? 'proj' : null,
  };
});

const { searchMemoryMock } = vi.hoisted(() => ({ searchMemoryMock: vi.fn() }));
vi.mock('../../../src/lib/memory/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/memory/cli.js')>();
  return { ...actual, searchMemory: searchMemoryMock };
});

import { memorySearchCommand } from '../../../src/cli/commands/memory.js';

describe('pan memory search --facts (PAN-4940 WI-1)', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;
  let previousCwd: string;
  let projectRoot: string;
  let workspaceRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-search-facts-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectRoot = join(tmpRoot, 'project');
    projectPathRef.current = projectRoot;
    workspaceRoot = join(projectRoot, 'workspaces', 'feature-x');
    previousCwd = process.cwd();
    mkdirSync(workspaceRoot, { recursive: true });
    process.chdir(workspaceRoot);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitCodes = [];
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCodes.push(code ?? 0);
      throw new Error(`exit(${code ?? 0})`);
    });

    searchMemoryMock.mockReset();
    searchMemoryMock.mockResolvedValue([]);
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

  function parseEnvelope(): { facts: unknown[]; observations: unknown[] } {
    const line = logSpy.mock.calls.flat().find((call) => typeof call === 'string' && call.startsWith('{'));
    expect(line).toBeDefined();
    return JSON.parse(line as string);
  }

  it('--facts without --json exits 1', async () => {
    await expect(memorySearchCommand('decide', { facts: true })).rejects.toThrow('exit(1)');
    expect(exitCodes).toEqual([1]);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--facts needs --json');
  });

  it('reads project facts from the cwd checkout', async () => {
    writeFact(
      join(workspaceRoot, '.overdeck', 'memory'),
      'in-workspace',
      '---\ntype: feedback\ndescription: Decide fast from the workspace.\n---\nBody.\n',
    );
    writeFact(
      join(projectRoot, '.overdeck', 'memory'),
      'in-primary',
      '---\ntype: feedback\ndescription: Decide fast from the primary checkout.\n---\nBody.\n',
    );

    await memorySearchCommand('decide', { facts: true, json: true });

    const envelope = parseEnvelope();
    const ids = envelope.facts.map((fact: any) => fact.id);
    expect(ids).toContain('in-workspace');
    expect(ids).not.toContain('in-primary');
    const workspaceFact = envelope.facts.find((fact: any) => fact.id === 'in-workspace') as any;
    expect(workspaceFact.scope).toBe('project');
    expect(workspaceFact.file).toContain(workspaceRoot);
  });

  it("--project reads that project's primary store", async () => {
    writeFact(
      join(projectRoot, '.overdeck', 'memory'),
      'in-primary',
      '---\ntype: feedback\ndescription: Decide fast from the primary checkout.\n---\nBody.\n',
    );

    await memorySearchCommand('decide', { facts: true, json: true, project: 'overdeck' });

    const envelope = parseEnvelope();
    const ids = envelope.facts.map((fact: any) => fact.id);
    expect(ids).toContain('in-primary');
  });

  it('adds operator and machine facts, at most 5 per store, active only', async () => {
    const home = process.env.OVERDECK_HOME as string;
    for (let i = 0; i < 7; i += 1) {
      writeFact(join(home, 'context', 'memory'), `op-fact-${i}`, `---\ntype: feedback\ndescription: Decide fast op ${i}.\n---\nBody.\n`);
    }
    writeFact(
      join(home, 'context', 'memory'),
      'op-reviewed',
      '---\ntype: feedback\ndescription: Decide fast but under review.\nreview: ["flagged"]\n---\nBody.\n',
    );
    writeFact(join(home, 'context', 'machine-memory'), 'gpu-fact', '---\ntype: reference\ndescription: Decide fast gpu.\n---\nBody.\n');

    await memorySearchCommand('decide', { facts: true, json: true });

    const envelope = parseEnvelope();
    const operatorFacts = envelope.facts.filter((fact: any) => fact.scope === 'user');
    expect(operatorFacts).toHaveLength(5);
    expect(operatorFacts.map((fact: any) => fact.id)).not.toContain('op-reviewed');
    const machineFacts = envelope.facts.filter((fact: any) => fact.scope === 'machine');
    expect(machineFacts.map((fact: any) => fact.id)).toContain('gpu-fact');
  });

  it('scopes observations to the cwd project', async () => {
    await memorySearchCommand('decide', { facts: true, json: true });
    expect(searchMemoryMock).toHaveBeenCalledWith('decide', expect.objectContaining({ project: 'proj' }));

    searchMemoryMock.mockClear();
    process.chdir(tmpRoot);
    await memorySearchCommand('decide', { facts: true, json: true });
    expect(searchMemoryMock).toHaveBeenCalledWith('decide', expect.objectContaining({ global: true }));

    searchMemoryMock.mockClear();
    process.chdir(workspaceRoot);
    await memorySearchCommand('decide', { facts: true, json: true, global: true });
    const [, calledOptions] = searchMemoryMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledOptions.project).toBeUndefined();
    expect(calledOptions.global).toBe(true);
  });

  it('prints one line with short observations', async () => {
    searchMemoryMock.mockResolvedValue([
      {
        observation: {
          id: 'obs-1', issueId: 'PAN-1', timestamp: '2026-01-01T00:00:00Z', projectId: 'proj',
          workspaceId: 'w1', actionStatus: 'did a thing', summary: 's', files: [],
          narrative: 'a very long narrative that should not appear in the envelope',
          tokens: { prompt: 1, completion: 2, total: 3 },
        },
        score: 1,
      },
    ]);

    await memorySearchCommand('decide', { facts: true, json: true });

    const line = logSpy.mock.calls.flat().find((call) => typeof call === 'string' && call.startsWith('{')) as string;
    expect(line.includes('\n')).toBe(false);
    const envelope = JSON.parse(line);
    expect(envelope.observations).toHaveLength(1);
    expect(envelope.observations[0].summary).toBe('s');
    expect(envelope.observations[0].narrative).toBeUndefined();
    expect(envelope.observations[0].tokens).toBeUndefined();
  });
});
