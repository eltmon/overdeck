/**
 * "Add this project to <machine>" (PAN-4651 FR-4, D-4651-14).
 *
 * `startAddProject` clones a repository through the project-creation core
 * (`resolveProjectCreateIntent` + the create job behind `POST /api/projects`)
 * and, once the job ends `done`, writes each copied git-ignored file (0600,
 * never overwriting: an existing file is `skipped`) at the same relative path
 * in the new project. An add job moves `clone` → `files` → `done`, or
 * `failed`; jobs live in memory like create jobs.
 *
 * `addProjectHere` is the viewer direction: it reads the source facts and the
 * selected files from the owner through the link (operator actor), then runs
 * `startAddProject` on this machine. The owner direction (`POST
 * /api/machines/work/projects`, WI-19) calls `startAddProject` with the files
 * it received.
 */
import { randomUUID } from 'node:crypto';

import type { ProjectCreateInput, ResolvedProjectIntent } from '../../../lib/projects/create.js';
import { resolveProjectCreateIntent } from '../../../lib/projects/create.js';
import { MAX_PROJECT_FILE_BYTES, writeProjectFileExclusive } from '../../../lib/projects/ignored-files.js';
import { linkFetch, linkForward } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import {
  getProjectCreateJob,
  type ProjectCreateJob,
  reserveProjectCreateOperation,
  startProjectCreateJob,
} from '../routes/project-create-jobs.js';

export const ADD_JOB_POLL_MS = 1_000;

export type AddProjectStep = 'clone' | 'files' | 'done' | 'failed';

export interface AddProjectJob {
  step: AddProjectStep;
  error?: string;
  projectKey?: string;
  files?: Array<{ path: string; result: 'written' | 'skipped' | 'failed' }>;
}

export interface AddProjectRequest {
  cloneUrl: string;
  name: string;
  issuePrefix: string | null;
  parentDir?: string;
  files: Array<{ path: string; contents: Buffer }>;
}

export interface AddProjectDeps {
  resolveIntent: (input: ProjectCreateInput) => Promise<ResolvedProjectIntent>;
  /** Reserve and start the create job; a string is the refusal. */
  startJob: (intent: ResolvedProjectIntent) => string | { refused: string };
  jobStatus: (jobId: string) => ProjectCreateJob | undefined;
  writeFile: (root: string, path: string, contents: Buffer) => Promise<'written' | 'skipped'>;
}

export const defaultAddProjectDeps: AddProjectDeps = {
  resolveIntent: resolveProjectCreateIntent,
  startJob: (intent) => {
    const operationId = randomUUID();
    const reservation = reserveProjectCreateOperation({ operationId, intent });
    if (reservation.status === 'conflict' || reservation.status === 'target-busy') return { refused: reservation.reason };
    return startProjectCreateJob(intent, { operationId });
  },
  jobStatus: getProjectCreateJob,
  writeFile: writeProjectFileExclusive,
};

const jobs = new Map<string, AddProjectJob>();

export function getAddProjectJob(id: string): AddProjectJob | undefined {
  const job = jobs.get(id);
  return job ? { ...job, ...(job.files ? { files: [...job.files] } : {}) } : undefined;
}

export function _resetAddProjectJobsForTests(): void {
  jobs.clear();
}

export type StartAddProjectResult = { ok: true; jobId: string } | { ok: false; status: number; body: Record<string, unknown> };

async function follow(job: AddProjectJob, createJobId: string, request: AddProjectRequest, deps: AddProjectDeps): Promise<void> {
  for (;;) {
    const created = deps.jobStatus(createJobId);
    if (!created) {
      Object.assign(job, { step: 'failed', error: 'The clone job disappeared (the dashboard restarted?)' });
      return;
    }
    if (created.status === 'failed' || created.status === 'cancelled') {
      Object.assign(job, { step: 'failed', error: created.failure?.message ?? created.error ?? `the clone ${created.status}` });
      return;
    }
    if (created.status === 'done' && created.result) {
      job.step = 'files';
      job.projectKey = created.result.key;
      job.files = [];
      for (const file of request.files) {
        const result = await deps.writeFile(created.result.path, file.path, file.contents).catch(() => 'failed' as const);
        job.files.push({ path: file.path, result });
      }
      job.step = 'done';
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ADD_JOB_POLL_MS));
  }
}

/** Clone and register the project here, then write the copied files; answers the add job id. */
export async function startAddProject(request: AddProjectRequest, deps: AddProjectDeps = defaultAddProjectDeps): Promise<StartAddProjectResult> {
  const tooLarge = request.files.find((file) => file.contents.length > MAX_PROJECT_FILE_BYTES);
  if (tooLarge) return { ok: false, status: 400, body: { code: 'file-too-large', error: `${tooLarge.path} is larger than 1 MiB` } };
  const intent = await deps.resolveIntent({
    mode: 'clone', url: request.cloneUrl, name: request.name, issuePrefix: request.issuePrefix ?? undefined,
    homeBoundary: true, refreshRemote: true, ...(request.parentDir ? { parentDir: request.parentDir } : {}),
  });
  if (intent.findings.length > 0) return { ok: false, status: 422, body: { code: 'cannot-clone', findings: intent.findings, error: intent.findings.map((finding) => finding.message).join('; ') } };
  const started = deps.startJob(intent);
  if (typeof started !== 'string') return { ok: false, status: 409, body: { code: 'busy', error: started.refused } };
  const jobId = randomUUID();
  const job: AddProjectJob = { step: 'clone' };
  jobs.set(jobId, job);
  void follow(job, started, request, deps).catch((error: Error) => Object.assign(job, { step: 'failed', error: error.message }));
  return { ok: true, jobId };
}

export interface OwnerSource {
  key: string;
  name: string;
  issuePrefix: string | null;
  gitOrigin: string | null;
  cloneUrl: string | null;
  ignoredFiles: Array<{ path: string; bytes: number; preselected: boolean }>;
}

export interface AddHereDeps {
  fetchSource: (environmentId: string, projectKey: string) => Promise<{ status: number; json: unknown }>;
  fetchFile: (environmentId: string, projectKey: string, path: string) => Promise<{ status: number; body: Buffer }>;
  start: (request: AddProjectRequest) => Promise<StartAddProjectResult>;
}

export const defaultAddHereDeps: AddHereDeps = {
  fetchSource: (environmentId, projectKey) =>
    linkFetch(environmentId, `/api/machines/projects/${encodeURIComponent(projectKey)}/source`, { actor: 'operator' }),
  fetchFile: async (environmentId, projectKey, path) => {
    const response = await linkForward(environmentId, {
      method: 'GET',
      path: `/api/machines/projects/${encodeURIComponent(projectKey)}/file?path=${encodeURIComponent(path)}`,
      actor: 'operator',
    });
    return { status: response.status, body: response.body };
  },
  start: (request) => startAddProject(request),
};

/** The owner's source facts for a project; a refusal passes its status and body through. */
export async function readOwnerSource(link: MachineLink, projectKey: string, deps: Pick<AddHereDeps, 'fetchSource'> = defaultAddHereDeps): Promise<{ ok: true; source: OwnerSource } | { ok: false; status: number; body: Record<string, unknown> }> {
  const answer = await deps.fetchSource(link.environmentId, projectKey);
  if (answer.status !== 200) {
    const body = (answer.json ?? {}) as Record<string, unknown>;
    return { ok: false, status: answer.status, body: { ...body, error: typeof body.error === 'string' ? body.error : `${link.label} answered ${answer.status}` } };
  }
  return { ok: true, source: answer.json as OwnerSource };
}

/** `POST /api/fleet/projects/add-here`: copy a linked machine's project (and the chosen files) to this machine. */
export async function addProjectHere(
  input: { link: MachineLink; projectKey: string; files: readonly string[]; includePreselected: boolean; parentDir?: string },
  deps: AddHereDeps = defaultAddHereDeps,
): Promise<StartAddProjectResult> {
  const read = await readOwnerSource(input.link, input.projectKey, deps);
  if (!read.ok) return read;
  const { source } = read;
  if (!source.cloneUrl) return { ok: false, status: 409, body: { code: 'no-clone-url', error: `${source.name} on ${input.link.label} has no origin remote to clone` } };
  const offered = new Set(source.ignoredFiles.map((file) => file.path));
  const wanted = new Set([...input.files, ...(input.includePreselected ? source.ignoredFiles.filter((file) => file.preselected).map((file) => file.path) : [])]);
  const unknown = [...wanted].filter((path) => !offered.has(path));
  if (unknown.length > 0) return { ok: false, status: 400, body: { code: 'unknown-file', error: `${input.link.label} offers no ignored file ${unknown.join(', ')}` } };
  const files: AddProjectRequest['files'] = [];
  for (const path of wanted) {
    const file = await deps.fetchFile(input.link.environmentId, input.projectKey, path);
    if (file.status !== 200) return { ok: false, status: 502, body: { code: 'file-unreadable', error: `Could not read ${path} from ${input.link.label} (${file.status})` } };
    files.push({ path, contents: file.body });
  }
  return deps.start({ cloneUrl: source.cloneUrl, name: source.name, issuePrefix: source.issuePrefix, ...(input.parentDir ? { parentDir: input.parentDir } : {}), files });
}
