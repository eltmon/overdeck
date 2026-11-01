/** PAN-4651 WI-18 (D-4651-14): Add this project here — clone, register, then write the copied files. */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { ResolvedProjectIntent } from '../../../lib/projects/create.js';
import { writeProjectFileExclusive } from '../../../lib/projects/ignored-files.js';
import {
  _resetAddProjectJobsForTests,
  type AddProjectDeps,
  addProjectHere,
  getAddProjectJob,
  startAddProject,
} from '../services/fleet-add-project.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
let clonePath: string;

function createDeps(): AddProjectDeps & { resolveIntent: ReturnType<typeof vi.fn> } {
  return {
    resolveIntent: vi.fn(async () => ({ mode: 'clone', key: 'overdeck', name: 'Overdeck', path: clonePath, findings: [] }) as unknown as ResolvedProjectIntent),
    startJob: () => 'create-job-1',
    jobStatus: () => ({ id: 'create-job-1', operationId: 'op', status: 'done', phase: 'done', percent: 100, startedAt: 0, result: { key: 'overdeck', name: 'Overdeck', path: clonePath, mainWorkspaceId: 'w', seededContextLayer: false, hooksInstalled: 0 } }),
    writeFile: writeProjectFileExclusive,
  };
}

/**
 * The job writes real files, so it settles after real I/O: wait on a time
 * bound, not a count of event-loop turns (a loaded CI runner needs more turns).
 */
function settled(jobId: string) {
  return vi.waitFor(() => {
    const job = getAddProjectJob(jobId);
    if (job?.step !== 'done' && job?.step !== 'failed') throw new Error(`add job ${jobId} did not settle (step ${job?.step ?? 'missing'})`);
    return job;
  }, { timeout: 10_000, interval: 5 });
}

beforeEach(() => {
  clonePath = mkdtempSync(join(tmpdir(), 'pan-4651-add-here-'));
  _resetAddProjectJobsForTests();
});

afterEach(() => rmSync(clonePath, { recursive: true, force: true }));

describe('startAddProject (D-4651-14)', () => {
  it('ac18: clones through the creation core, registers, and writes .env with mode 0600', async () => {
    const deps = createDeps();
    const started = await startAddProject({ cloneUrl: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN', files: [{ path: '.env', contents: Buffer.from('TOKEN=abc\n') }] }, deps);
    expect(started.ok).toBe(true);
    expect(deps.resolveIntent).toHaveBeenCalledWith(expect.objectContaining({ mode: 'clone', url: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN', homeBoundary: true, refreshRemote: true }));
    const job = await settled((started as { jobId: string }).jobId);
    expect(job).toEqual({ step: 'done', projectKey: 'overdeck', files: [{ path: '.env', result: 'written' }] });
    expect(statSync(join(clonePath, '.env')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(clonePath, '.env'), 'utf8')).toBe('TOKEN=abc\n');
  });

  it('ac18: an existing local .env is reported skipped and not overwritten', async () => {
    writeFileSync(join(clonePath, '.env'), 'MINE=1\n');
    const started = await startAddProject({ cloneUrl: 'u', name: 'Overdeck', issuePrefix: null, files: [{ path: '.env', contents: Buffer.from('THEIRS=1\n') }] }, createDeps());
    const job = await settled((started as { jobId: string }).jobId);
    expect(job.files).toEqual([{ path: '.env', result: 'skipped' }]);
    expect(readFileSync(join(clonePath, '.env'), 'utf8')).toBe('MINE=1\n');
  });

  it('a failed clone fails the add job; intent findings answer 422', async () => {
    const failing = { ...createDeps(), jobStatus: () => ({ id: 'j', operationId: 'op', status: 'failed' as const, phase: 'x', percent: null, startedAt: 0, error: 'auth failed' }) };
    const started = await startAddProject({ cloneUrl: 'u', name: 'X', issuePrefix: null, files: [] }, failing);
    expect(await settled((started as { jobId: string }).jobId)).toEqual({ step: 'failed', error: 'auth failed' });
    const findings = { ...createDeps(), resolveIntent: vi.fn(async () => ({ findings: [{ message: 'destination exists' }] }) as unknown as ResolvedProjectIntent) };
    expect(await startAddProject({ cloneUrl: 'u', name: 'X', issuePrefix: null, files: [] }, findings)).toMatchObject({ ok: false, status: 422 });
  });
});

describe('addProjectHere (D-4651-14)', () => {
  const source = {
    key: 'od', name: 'Overdeck', issuePrefix: 'PAN', gitOrigin: 'github.com/eltmon/overdeck', cloneUrl: 'https://github.com/eltmon/overdeck.git',
    ignoredFiles: [{ path: '.env', bytes: 10, preselected: true }, { path: 'notes.local', bytes: 4, preselected: false }],
  };

  it('reads the source and the chosen files from the owner, preselected ones included on request', async () => {
    const start = vi.fn(async () => ({ ok: true as const, jobId: 'add-1' }));
    const fetchFile = vi.fn(async (_env: string, _key: string, path: string) => ({ status: 200, body: Buffer.from(`${path}-bytes`) }));
    const result = await addProjectHere({ link: DESK, projectKey: 'od', files: ['notes.local'], includePreselected: true }, {
      fetchSource: async () => ({ status: 200, json: source }), fetchFile, start,
    });
    expect(result).toEqual({ ok: true, jobId: 'add-1' });
    expect(start).toHaveBeenCalledWith({
      cloneUrl: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN',
      files: [{ path: 'notes.local', contents: Buffer.from('notes.local-bytes') }, { path: '.env', contents: Buffer.from('.env-bytes') }],
    });
  });

  it('refuses a file the owner does not offer, and passes an owner refusal through', async () => {
    const start = vi.fn();
    const unknown = await addProjectHere({ link: DESK, projectKey: 'od', files: ['../secrets'], includePreselected: false }, {
      fetchSource: async () => ({ status: 200, json: source }), fetchFile: vi.fn(), start,
    });
    expect(unknown).toMatchObject({ ok: false, status: 400, body: { code: 'unknown-file' } });
    const forbidden = await addProjectHere({ link: DESK, projectKey: 'od', files: [], includePreselected: true }, {
      fetchSource: async () => ({ status: 403, json: { code: 'project-files-forbidden', error: 'operator only' } }), fetchFile: vi.fn(), start,
    });
    expect(forbidden).toMatchObject({ ok: false, status: 403, body: { code: 'project-files-forbidden' } });
    expect(start).not.toHaveBeenCalled();
  });
});
