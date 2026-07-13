import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');

export function loadPromptFile(relPath: string): string {
  const fullPath = path.resolve(repoRoot, relPath);
  try {
    return readFileSync(fullPath, 'utf8');
  } catch {
    throw new Error(`Prompt file not found: ${relPath} (resolved to ${fullPath})`);
  }
}

export interface RunPromptScenarioOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

export async function runPromptScenario(opts: RunPromptScenarioOptions): Promise<string> {
  const model = process.env['OVERDECK_EVAL_MODEL'];
  if (!model) {
    throw new Error(
      'OVERDECK_EVAL_MODEL is not set — live prompt evals require an explicit eval model (no hardcoded fallback). Example: OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval',
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

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to code-fence and bracket extraction.
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to bracket extraction.
    }
  }

  const start = trimmed.indexOf('[');
  if (start === -1) {
    throw new Error('No JSON array found in response');
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1)) as unknown[];
        } catch {
          break;
        }
      }
    }
  }

  throw new Error('No JSON array found in response');
}
