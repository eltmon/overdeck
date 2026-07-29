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
import { flushAutoCommits, pushPendingStateCommits, queueAutoCommit, type FlushResult } from '../pan-dir/auto-commit.js';
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

/** Queues + flushes a commit for `targetPath` and returns the raw FlushResult (never throws). */
function flushMirrorCommit(project: ProjectConfig, targetPath: string, subject: string): Promise<FlushResult> {
  queueAutoCommit({ projectRoot: project.path, paths: [targetPath], subject });
  return Effect.runPromise(flushAutoCommits(project.path));
}

async function commitMirror(project: ProjectConfig, targetPath: string, subject: string): Promise<void> {
  const flushed = await flushMirrorCommit(project, targetPath, subject);
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
 * Review fix (cycle 3, corrected in cycle 4): a prior call can have already
 * deleted `target` from disk and either (a) fully committed that removal
 * locally but failed only at the push step, or (b) failed at `git add`/`git
 * commit` itself (index lock, hook/signing failure, branch mismatch) — in
 * which case NOTHING was committed at all. Cycle 3's fix treated both the
 * same way (push-only retry), which silently "succeeds" for case (b): there
 * is nothing ahead to push, `git push` reports success trivially, and the
 * remote mirror is never actually removed while the caller believes it was.
 *
 * The fix: re-run the SAME add+commit+push flow first — `git add` on a path
 * that no longer exists on disk but is still tracked STAGES the deletion
 * (identical to `git rm`), so this correctly recovers case (b) by actually
 * committing the deletion this time. Only when that reports "nothing to
 * commit" (a real diff never existed for this attempt — the deletion is
 * either already fully committed, or this pin's mirror was never written in
 * the first place) does it fall back to retrying the push alone, which
 * covers case (a) and is a safe no-op for "never mirrored."
 */
export async function removeMemoryStateMirror(projectId: string, relativePath: string, subject: string): Promise<void> {
  assertMirrorable(relativePath);
  const project = getProjectSync(projectId);
  if (!project) return;
  const target = join(resolveStateDomainPathSync(project, MEMORY_STATE_DOMAIN), relativePath);
  if (!existsSync(target)) {
    const flushed = await flushMirrorCommit(project, target, subject);
    if (flushed.errored) {
      throw new Error(flushed.reason ?? `memory state mirror retry commit failed: ${target}`);
    }
    if (flushed.committed) {
      if (flushed.pushed === false) {
        throw new Error(flushed.reason ?? `memory state mirror retry commit was not pushed: ${target}`);
      }
      return;
    }
    // Nothing new to add/commit for this exact path this attempt.
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
