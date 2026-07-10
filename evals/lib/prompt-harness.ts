import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

/**
 * Shared live-model prompt-eval harness for PAN-2229.
 *
 * Used by the role-scenario evals (flywheel launch-vs-report, review
 * synthesis canonical blocker format, …) to load the actual prompt
 * surface under evaluation, run it against the explicit eval model in
 * `OVERDECK_EVAL_MODEL`, and parse the structured response.
 *
 * Repo rules enforced here:
 *   - "Never hardcode a model fallback" — `runPromptScenario` rejects
 *     before any network call when `OVERDECK_EVAL_MODEL` is unset.
 *     There is intentionally no default model constant anywhere in this
 *     file; the only model string the harness ever touches is the one
 *     the operator exports into the environment.
 *   - "No live-model calls in blocking CI" — callers gate CI on the
 *     presence of `OVERDECK_EVAL_MODEL`; this module just enforces the
 *     fail-loud posture.
 */

export interface RunPromptScenarioOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

interface AnthropicTextBlockLike {
  type: string;
  text?: unknown;
}

function isTextBlock(block: unknown): block is AnthropicTextBlockLike & { text: string } {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === 'text' && typeof candidate.text === 'string';
}

/**
 * Resolve the repo root from this module's location on disk so callers
 * can pass paths like `roles/flywheel.md` or `docs/flywheel-brief.md`
 * regardless of the current working directory. `evals/` runs with
 * `cwd=evals/` (`npm run eval` → `cd evals && evalite .`), so a
 * `process.cwd()`-relative read would resolve to the wrong directory.
 *
 * `evals/lib/prompt-harness.ts` sits two directories below the repo
 * root: walk up two levels from `import.meta.url`.
 */
function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

/**
 * Load a prompt file (e.g. `roles/flywheel.md`, `docs/flywheel-brief.md`)
 * from the repo root. Throws a descriptive error when the file is
 * missing so eval failures surface a clear path instead of an opaque
 * `ENOENT` from `readFileSync`.
 */
export function loadPromptFile(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error(`loadPromptFile: relPath must be a non-empty string, got ${String(relPath)}`);
  }
  const absolutePath = resolve(resolveRepoRoot(), relPath);
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`loadPromptFile: cannot read ${relPath} (resolved ${absolutePath}): ${reason}`);
  }
}

/**
 * Run a single prompt scenario against the explicit eval model in
 * `OVERDECK_EVAL_MODEL`. Fails loudly when the env var is unset — no
 * hardcoded fallback, by repo rule.
 *
 * Example:
 *   OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval
 */
export async function runPromptScenario(opts: RunPromptScenarioOptions): Promise<string> {
  const model = process.env.OVERDECK_EVAL_MODEL;
  if (!model || model.trim() === '') {
    throw new Error(
      "OVERDECK_EVAL_MODEL is not set — live prompt evals require an explicit eval model " +
        "(no hardcoded fallback). Example: " +
        "OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval",
    );
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: 0,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const blocks = response.content as unknown[];
  return blocks
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('');
}

/**
 * Leniently extract the first top-level JSON array from a model
 * response. Strips ```json ... ``` (and bare ``` ... ```) code fences,
 * then scans for the first `[ ... ]` that parses as JSON. Throws a
 * descriptive error when no array parses so eval failures point at
 * the response shape, not at a downstream `undefined.length`.
 */
export function extractJsonArray(text: string): unknown[] {
  const stripped = stripCodeFences(text);
  const arrayText = firstArrayLiteral(stripped);
  if (arrayText === null) {
    throw new Error(
      `extractJsonArray: no JSON array found in response (first 200 chars: ${JSON.stringify(stripped.slice(0, 200))})`,
    );
  }
  try {
    const parsed = JSON.parse(arrayText);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `extractJsonArray: top-level JSON value was ${typeof parsed}, expected array ` +
          `(snippet: ${JSON.stringify(arrayText.slice(0, 200))})`,
      );
    }
    return parsed;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`extractJsonArray: failed to parse JSON array: ${reason}`);
  }
}

function stripCodeFences(text: string): string {
  // Strip a single ``` or ```json fenced block if the entire response
  // is wrapped in one — the common case for structured-output models.
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fenced) {
    return fenced[1];
  }
  return text;
}

function firstArrayLiteral(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}