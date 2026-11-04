/**
 * PAN-4940 WI-4 (issue AC-11): feeds the exact argv the self-memory routes
 * build into the real `pan memory` commander program, through an in-process
 * SelfJobRunner, so a flag-format mismatch between the route and the CLI
 * fails here rather than only in the routes' own argv-only tests.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

vi.mock('../../../src/lib/memory/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/memory/cli.js')>();
  return { ...actual, searchMemory: vi.fn().mockResolvedValue([]) };
});

import type { SelfCallerDeps } from '../../../src/dashboard/server/self-caller.js';
import type { DashboardCredential } from '../../../src/dashboard/server/routes/dashboard-auth.js';
import { createSelfJobs, type SelfJobRunInput, type SelfJobRunResult } from '../../../src/dashboard/server/services/self-jobs.js';
import { handleSelfMemoryAdd, handleSelfMemorySearch } from '../../../src/dashboard/server/routes/self-memory.js';
import { createMemoryCommand } from '../../../src/cli/commands/memory.js';
import { memoryFactListCommand } from '../../../src/cli/commands/memory-facts.js';

describe('self-memory routes through the real pan memory program (PAN-4940 WI-4, issue AC-11)', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;
  let previousCwd: string;
  let projectRoot: string;
  let workspace: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-self-roundtrip-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectRoot = join(tmpRoot, 'project');
    projectPathRef.current = projectRoot;
    workspace = join(projectRoot, 'workspaces', 'feature-x');
    previousCwd = process.cwd();
    mkdirSync(workspace, { recursive: true });

    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
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

  /** An in-process SelfJobRunner: parses the real argv into createMemoryCommand(), capturing console output. */
  async function inProcessRunner(input: SelfJobRunInput): Promise<SelfJobRunResult> {
    const previous = process.cwd();
    process.chdir(input.cwd);
    const out: string[] = [];
    const err: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      err.push(a.join(' '));
    });
    try {
      await createMemoryCommand().exitOverride().parseAsync(input.args.slice(2), { from: 'user' });
      return { exitCode: 0, signal: null, timedOut: false, stdout: out.join('\n'), stderr: err.join('\n'), error: null };
    } catch (error) {
      err.push(String(error));
      return { exitCode: 1, signal: null, timedOut: false, stdout: out.join('\n'), stderr: err.join('\n'), error: null };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.chdir(previous);
    }
  }

  function makeJobs() {
    return createSelfJobs({ runner: inProcessRunner });
  }

  const callerDeps: SelfCallerDeps = {
    getAgentState: (agentId) => (agentId === 'agent-pan-1' ? { workspace, issueId: 'PAN-1' } : null),
    getConversationByName: () => null,
  };

  const credential: DashboardCredential = {
    kind: 'token',
    tokenId: 'tok-agent-pan-1',
    scopes: ['tell', 'read:state'],
    agentId: 'agent-pan-1',
    agentKind: 'agent',
    role: 'work',
  };

  it('memory_add then memory_search returns the fact', async () => {
    const jobs = makeJobs();
    const addResult = await handleSelfMemoryAdd(
      credential,
      JSON.stringify({ id: 'round-trip-fact', type: 'project', description: 'Releases need a signed tag.' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    expect(addResult.status).toBe(200);
    const addBody = addResult.body as { status: string; exitCode: number; stdout: string };
    expect(addBody.status).toBe('done');
    expect(addBody.exitCode).toBe(0);
    const addStdout = JSON.parse(addBody.stdout) as { file: string };
    expect(addStdout.file).toBe(join(workspace, '.overdeck', 'memory', 'round-trip-fact.md'));

    process.chdir(workspace);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.join(' ')));
    try {
      await memoryFactListCommand({ here: true, json: true });
    } finally {
      logSpy.mockRestore();
    }
    const listed = JSON.parse(logs.join('\n')) as { facts: Array<{ id: string }> };
    expect(listed.facts.map((fact) => fact.id)).toContain('round-trip-fact');

    const searchResult = await handleSelfMemorySearch(credential, JSON.stringify({ query: 'signed tag' }), undefined, { jobs, caller: callerDeps });
    expect(searchResult.status).toBe(200);
    const searchBody = searchResult.body as { status: string; stdout: string };
    expect(searchBody.status).toBe('done');
    const searched = JSON.parse(searchBody.stdout) as { facts: Array<{ id: string; scope: string }> };
    expect(searched.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'round-trip-fact', scope: 'project' })]));
  });

  it('a type user fact lands in the operator store', async () => {
    const jobs = makeJobs();
    const addResult = await handleSelfMemoryAdd(
      credential,
      JSON.stringify({ id: 'op-fact', type: 'user', description: 'Prefers short answers.' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    const addBody = addResult.body as { status: string; stdout: string };
    expect(addBody.status).toBe('done');
    const addStdout = JSON.parse(addBody.stdout) as { file: string };
    expect(addStdout.file).toBe(join(process.env.OVERDECK_HOME as string, 'context', 'memory', 'op-fact.md'));

    const searchResult = await handleSelfMemorySearch(credential, JSON.stringify({ query: 'short answers' }), undefined, { jobs, caller: callerDeps });
    const searchBody = searchResult.body as { status: string; stdout: string };
    const searched = JSON.parse(searchBody.stdout) as { facts: Array<{ id: string; scope: string }> };
    expect(searched.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'op-fact', scope: 'user' })]));
  });

  it('an existing id is a done answer with exitCode 1', async () => {
    const jobs = makeJobs();
    await handleSelfMemoryAdd(
      credential,
      JSON.stringify({ id: 'round-trip-fact', type: 'project', description: 'Releases need a signed tag.' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    const second = await handleSelfMemoryAdd(
      credential,
      JSON.stringify({ id: 'round-trip-fact', type: 'project', description: 'Releases need a signed tag.' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    const body = second.body as { status: string; exitCode: number; stderr: string };
    expect(body.status).toBe('done');
    expect(body.exitCode).toBe(1);
    expect(body.stderr).toContain('already exists');
  });
});
