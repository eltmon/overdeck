/**
 * Agent definition model-sync
 *
 * Rewrites the `model:` frontmatter field in each cached agent-definition .md
 * file based on the active work-type router configuration. Without this, agent
 * files ship with a hardcoded `model: haiku|sonnet` that silently wins over
 * any per-work-type override declared in ~/.panopticon/config.yaml, which
 * causes subagents to request Claude model IDs that the proxy (cliproxy) may
 * not know about — producing 502 "unknown provider for model" errors.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CACHE_AGENTS_DIR } from './paths.js';
import { getGlobalRouter } from './work-type-router.js';
import { isValidWorkType, WorkTypeId } from './work-types.js';

/**
 * Map from agent definition filename (without .md) to the work-type ID that
 * should drive its model selection. Agents not listed keep their shipped
 * frontmatter untouched.
 */
export const AGENT_FILE_TO_WORK_TYPE: Record<string, WorkTypeId> = {
  'codebase-explorer': 'subagent:explore',
  'planning-agent': 'planning-agent',
  'code-review-correctness': 'review:correctness',
  'code-review-performance': 'review:performance',
  'code-review-security': 'review:security',
  'code-review-requirements': 'review:requirements',
  'code-review-synthesis': 'review:synthesis',
};

/**
 * Set the `model:` field inside a markdown file's YAML frontmatter.
 *
 * If the frontmatter already has a `model:` line, that line is replaced.
 * If the frontmatter exists but has no `model:` line, one is inserted
 * just before the closing `---`. Returns `null` if no well-formed
 * frontmatter block is present at all.
 *
 * Preserves every other line, spacing, and ordering exactly so idempotent
 * sync comparisons work.
 */
export function setFrontmatterModel(content: string, newModel: string): string | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') return null;

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  let modelIdx = -1;
  for (let i = 1; i < endIdx; i++) {
    if (/^model:\s/.test(lines[i])) {
      modelIdx = i;
      break;
    }
  }

  if (modelIdx !== -1) {
    lines[modelIdx] = `model: ${newModel}`;
  } else {
    lines.splice(endIdx, 0, `model: ${newModel}`);
  }
  return lines.join('\n');
}

export interface ApplyModelOverridesResult {
  updated: Array<{ file: string; workType: WorkTypeId; model: string }>;
  unchanged: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Rewrite `model:` frontmatter in every cached agent definition that has a
 * mapped work-type. Idempotent: only touches files whose current `model:`
 * value differs from the resolved configuration.
 */
export function applyModelOverridesToAgents(): ApplyModelOverridesResult {
  const result: ApplyModelOverridesResult = { updated: [], unchanged: [], skipped: [] };

  if (!existsSync(CACHE_AGENTS_DIR)) return result;

  const router = getGlobalRouter();
  const files = readdirSync(CACHE_AGENTS_DIR).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const stem = file.replace(/\.md$/, '');
    const workType = AGENT_FILE_TO_WORK_TYPE[stem];
    if (!workType) {
      result.skipped.push({ file, reason: 'no-mapping' });
      continue;
    }
    if (!isValidWorkType(workType)) {
      result.skipped.push({ file, reason: `invalid-work-type:${workType}` });
      continue;
    }

    const filePath = join(CACHE_AGENTS_DIR, file);
    const current = readFileSync(filePath, 'utf-8');
    const desired = router.getModelId(workType);
    const rewritten = setFrontmatterModel(current, desired);

    if (rewritten === null) {
      result.skipped.push({ file, reason: 'no-frontmatter-model' });
      continue;
    }
    if (rewritten === current) {
      result.unchanged.push(file);
      continue;
    }

    writeFileSync(filePath, rewritten, 'utf-8');
    result.updated.push({ file, workType, model: desired });
  }

  return result;
}
