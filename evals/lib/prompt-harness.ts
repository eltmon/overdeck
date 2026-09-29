import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { EffortLevel } from '@overdeck/contracts';
import { resolveEvalModelConfig, type EvalModelConfig, type EvalProvider, type OpenAIVia } from './eval-model.js';
import { evalCostUsd, usageFromAnthropic, type EvalUsage } from './eval-usage.js';

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
  /** Caps the resolved model's maxOutputTokens (or EVAL_DEFAULT_MAX_OUTPUT_TOKENS when unset). */
  maxTokens?: number;
}

export interface PromptScenarioRun {
  model: string;
  provider: EvalProvider;
  effort: EffortLevel | null;
  thinking: 'adaptive' | null;
  temperature: 0 | null;
  maxTokens: number;
  openaiVia: OpenAIVia | null;
  usage: EvalUsage;
  costUsd: number | null;
  costBasis: 'api' | 'api-equivalent';
  stopReason: string | null;
  durationMs: number;
}

export interface PromptScenarioResult {
  text: string;
  run: PromptScenarioRun;
}

interface ProviderCallResult {
  text: string;
  usage: EvalUsage;
  stopReason: string | null;
}

async function callAnthropic(config: EvalModelConfig, opts: RunPromptScenarioOptions): Promise<ProviderCallResult> {
  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: config.apiModel,
      max_tokens: config.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      ...(config.temperature !== null ? { temperature: config.temperature } : {}),
      ...(config.thinking !== null ? { thinking: { type: config.thinking } } : {}),
      ...(config.effort !== null ? { output_config: { effort: config.effort } } : {}),
    })
    .finalMessage();
  return {
    text: message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
    usage: usageFromAnthropic(message.usage),
    stopReason: message.stop_reason ?? null,
  };
}

export async function runPromptScenario(opts: RunPromptScenarioOptions): Promise<PromptScenarioResult> {
  const config = resolveEvalModelConfig(process.env, { maxTokens: opts.maxTokens });
  const startedAt = Date.now();
  if (config.provider !== 'anthropic') {
    throw new Error(`Eval provider "${config.provider}" is not wired yet`);
  }
  const result = await callAnthropic(config, opts);
  return {
    text: result.text,
    run: {
      model: config.model,
      provider: config.provider,
      effort: config.effort,
      thinking: config.thinking,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      openaiVia: config.openaiVia,
      usage: result.usage,
      costUsd: evalCostUsd(config.provider, config.model, result.usage),
      costBasis: config.openaiVia === 'cliproxy' ? 'api-equivalent' : 'api',
      stopReason: result.stopReason,
      durationMs: Date.now() - startedAt,
    },
  };
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
