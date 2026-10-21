/**
 * Sync conflict resolution for the operator memory store (PAN-4578 D10). When two
 * machines changed the same fact, the remote version keeps the fact id and this
 * machine's version becomes a review-marked conflict copy `<id>-conflict-<slug>.md`,
 * committed and pushed with the merge so every machine sees both. A review-marked
 * fact is never injected at launch. An edit always beats a deletion. Nothing here
 * leaves a merge blocked: every unmerged path is resolved and staged.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMORY_FACT_ID, parseMemoryFact, serializeMemoryFact } from './store.js';

export const SYNC_CONFLICT_REVIEW = 'sync-conflict';

/** `<id>-conflict-<slug>`, with the id cut so the result stays within MEMORY_FACT_ID's 80 characters. */
export function conflictCopyId(id: string, labelSlug: string): string {
  const suffix = `-conflict-${labelSlug}`;
  return `${id.slice(0, 80 - suffix.length)}${suffix}`;
}

function splitNul(text: string): string[] {
  return text.split('\0').filter(Boolean);
}

/** The stage numbers (1 base, 2 ours, 3 theirs) present for an unmerged path. */
async function unmergedStages(git: (args: string[]) => Promise<string>, path: string): Promise<Set<number>> {
  const stages = new Set<number>();
  for (const entry of splitNul(await git(['ls-files', '-u', '-z', '--', path]))) {
    // `<mode> <sha> <stage>\t<path>`
    const stage = Number(entry.split('\t')[0]?.split(' ')[2]);
    if (stage > 0) stages.add(stage);
  }
  return stages;
}

function conflictCopyText(dir: string, path: string, id: string, copyId: string, ours: string): string {
  const parsed = parseMemoryFact(join(dir, path), ours, 'user');
  if ('reason' in parsed) return ours;
  return serializeMemoryFact({
    ...parsed,
    id: copyId,
    review: [...new Set([...parsed.review, SYNC_CONFLICT_REVIEW])],
    source: `${SYNC_CONFLICT_REVIEW}:${id}`,
  });
}

/**
 * Resolve every unmerged path of an in-progress merge in `dir` and stage the result.
 * Returns the ids of the conflict copies written. The caller commits the merge.
 */
export async function resolveSyncConflicts(input: {
  dir: string;
  labelSlug: string;
  git: (args: string[]) => Promise<string>;
}): Promise<string[]> {
  const { dir, git } = input;
  const copies: string[] = [];
  for (const path of splitNul(await git(['diff', '--name-only', '--diff-filter=U', '-z']))) {
    const stages = await unmergedStages(git, path);
    const ours = stages.has(2);
    const theirs = stages.has(3);

    if (ours && theirs) {
      const id = path.replace(/\.md$/, '');
      const isFact = path.endsWith('.md') && path !== 'README.md' && !path.includes('/') && MEMORY_FACT_ID.test(id);
      // Read our version before checkout replaces the working-tree file. Never trim: the copy is byte for byte.
      const oursText = isFact ? await git(['show', `:2:${path}`]) : '';
      await git(['checkout', '--theirs', '--', path]);
      if (isFact) {
        const copyId = conflictCopyId(id, input.labelSlug);
        await writeFile(join(dir, `${copyId}.md`), conflictCopyText(dir, path, id, copyId, oursText), 'utf8');
        await git(['add', '--', `${copyId}.md`]);
        copies.push(copyId);
      }
    } else if (ours) {
      // They deleted, we edited: the edit wins.
      await git(['checkout', '--ours', '--', path]);
    } else {
      // We deleted, they edited: the edit wins.
      await git(['checkout', '--theirs', '--', path]);
    }
    await git(['add', '--', path]);
  }
  return copies;
}
