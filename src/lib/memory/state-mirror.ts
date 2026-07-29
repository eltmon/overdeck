/**
 * Memory state-domain mirror (PAN-1990 D-9).
 *
 * Durable memory artifacts — daily summaries and pinned-doc descriptors — are
 * mirrored onto the project's `overdeck-state` branch (or its legacy `.pan/`
 * equivalent pre-migration) through the same state-door commit path other
 * domain writers use (queueAutoCommit/flushAutoCommits). Rolling observations,
 * pending/, and status.json are high-churn and NEVER belong on the state
 * branch — writeMemoryStateMirror/removeMemoryStateMirror reject them.
 *
 * A projectId with no classic projects.yaml registration has nothing to
 * mirror to; callers no-op rather than fail, since mirroring is a durability
 * convenience, not the source of truth (the memory-home file is).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { getProjectSync, type ProjectConfig } from '../projects.js';
import { resolveStateDomainPathSync } from '../state-home.js';
import { flushAutoCommits, pushPendingStateCommits, queueAutoCommit } from '../pan-dir/auto-commit.js';
import type { PinScope } from '../workspaces/types.js';

const MEMORY_STATE_DOMAIN = 'memory';
const FORBIDDEN_MIRROR_PREFIXES = ['observations/', 'pending/'];

export class MemoryMirrorRejectedError extends Error {}

function assertMirrorable(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/');
  if (FORBIDDEN_MIRROR_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new MemoryMirrorRejectedError(`refusing to mirror rolling memory path onto the state branch: ${relativePath}`);
  }
}

async function commitMirror(project: ProjectConfig, targetPath: string, subject: string): Promise<void> {
  queueAutoCommit({ projectRoot: project.path, paths: [targetPath], subject });
  const flushed = await Effect.runPromise(flushAutoCommits(project.path));
  if (flushed.errored || flushed.pushed === false) {
    throw new Error(flushed.reason ?? `memory state mirror commit was not pushed: ${targetPath}`);
  }
}

/** Writes `relativePath` under the project's memory state-domain and commits+pushes it through the state door. */
export async function writeMemoryStateMirror(projectId: string, relativePath: string, content: string, subject: string): Promise<void> {
  assertMirrorable(relativePath);
  const project = getProjectSync(projectId);
  if (!project) return;
  const target = join(resolveStateDomainPathSync(project, MEMORY_STATE_DOMAIN), relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  await commitMirror(project, target, subject);
}

/**
 * Deletes `relativePath` under the project's memory state-domain and
 * commits+pushes the removal.
 *
 * Review fix (cycle 3): a prior call can have already deleted `target` and
 * committed that removal locally, then failed to push (lock contention,
 * non-fast-forward, network). On retry `target` no longer exists, so a plain
 * "nothing to do" here would strand that commit unpushed forever — the
 * caller (deleteWorkspace) would go on to delete the canonical row, leaving
 * no way to discover or retry the stuck push. Instead, retry the PUSH itself
 * (pushPendingStateCommits carries along any earlier stuck commit on the
 * same branch, even with nothing new to stage) and only return successfully
 * once that's confirmed — or there was genuinely nothing to push.
 */
export async function removeMemoryStateMirror(projectId: string, relativePath: string, subject: string): Promise<void> {
  assertMirrorable(relativePath);
  const project = getProjectSync(projectId);
  if (!project) return;
  const target = join(resolveStateDomainPathSync(project, MEMORY_STATE_DOMAIN), relativePath);
  if (!existsSync(target)) {
    const push = await Effect.runPromise(pushPendingStateCommits(project.path));
    if (push && !push.pushed) {
      throw new Error(push.reason ?? `memory state mirror retry-push was not confirmed: ${target}`);
    }
    return;
  }
  await rm(target);
  await commitMirror(project, target, subject);
}

export async function mirrorDailySummary(projectId: string, workspaceName: string, date: string, markdown: string): Promise<void> {
  const relativePath = join('summaries', projectId, `${workspaceName}-${date}.md`);
  await writeMemoryStateMirror(
    projectId,
    relativePath,
    markdown,
    `chore(memory): mirror daily summary ${projectId}/${workspaceName}-${date}`,
  );
}

interface PinMirrorDescriptor {
  scope: PinScope;
  scopeId: string;
  docPath: string;
  createdAt: number;
}

/**
 * Non-blocking review fix: replacing `/` with `__` made `a/b.md` and
 * `a__b.md` map to the same filename, so pinning one could silently overwrite
 * or delete the other's mirror descriptor. Hashing docPath instead of
 * transliterating it makes the filename collision-resistant regardless of
 * what characters the path contains; docPath itself is still stored inside
 * the JSON descriptor content for readability.
 */
function pinMirrorPath(scope: PinScope, scopeId: string, docPath: string): string {
  const docPathHash = createHash('sha256').update(docPath).digest('hex').slice(0, 16);
  return join('pins', `${scope}__${scopeId}__${docPathHash}.json`);
}

export async function mirrorPin(projectId: string, scope: PinScope, scopeId: string, docPath: string, createdAt: number): Promise<void> {
  const descriptor: PinMirrorDescriptor = { scope, scopeId, docPath, createdAt };
  await writeMemoryStateMirror(
    projectId,
    pinMirrorPath(scope, scopeId, docPath),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    `chore(memory): mirror pin ${scope}:${scopeId}:${docPath}`,
  );
}

export async function unmirrorPin(projectId: string, scope: PinScope, scopeId: string, docPath: string): Promise<void> {
  await removeMemoryStateMirror(
    projectId,
    pinMirrorPath(scope, scopeId, docPath),
    `chore(memory): unmirror pin ${scope}:${scopeId}:${docPath}`,
  );
}
