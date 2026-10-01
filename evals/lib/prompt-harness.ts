import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { EffortLevel } from '@overdeck/contracts';
import { callClaudeCli } from './claude-cli.js';
import {
  resolveEvalModelConfig,
  type AnthropicVia,
  type EvalModelConfig,
  type EvalProvider,
  type OpenAIVia,
} from './eval-model.js';
import { evalCostUsd, usageFromAnthropic, type EvalUsage } from './eval-usage.js';
import { callOpenAIResponses } from './openai-responses.js';

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

export interface ScenarioMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunPromptScenarioOptions {
  system: string;
  /** Single user turn. Exactly one of `user` / `messages` is required. */
  user?: string;
  /** Multi-turn conversation; must end with a user turn. */
  messages?: ScenarioMessage[];
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
  anthropicVia: AnthropicVia | null;
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

export function scenarioMessages(opts: Pick<RunPromptScenarioOptions, 'user' | 'messages'>): ScenarioMessage[] {
  if ((opts.user === undefined) === (opts.messages === undefined)) {
    throw new Error('runPromptScenario needs exactly one of `user` or `messages`.');
  }
  const messages = opts.messages ?? [{ role: 'user', content: opts.user! }];
  if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
    throw new Error('runPromptScenario `messages` must be non-empty and end with a user turn.');
  }
  return messages;
}

export interface ProviderCallResult {
  text: string;
  usage: EvalUsage;
  stopReason: string | null;
}

async function callAnthropic(
  config: EvalModelConfig,
  prompt: { system: string; messages: ScenarioMessage[] },
): Promise<ProviderCallResult> {
  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: config.apiModel,
      max_tokens: config.maxTokens,
      system: prompt.system,
      messages: prompt.messages,
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
  const prompt = { system: opts.system, messages: scenarioMessages(opts) };
  const config = resolveEvalModelConfig(process.env, { maxTokens: opts.maxTokens });
  const startedAt = Date.now();
  const result =
    config.provider === 'openai'
      ? await callOpenAIResponses(config, prompt, process.env)
      : config.anthropicVia === 'claude-cli'
        ? await callClaudeCli(config, prompt)
        : await callAnthropic(config, prompt);
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
      anthropicVia: config.anthropicVia,
      usage: result.usage,
      costUsd: evalCostUsd(config.provider, config.model, result.usage),
      costBasis: config.openaiVia === 'cliproxy' || config.anthropicVia === 'claude-cli' ? 'api-equivalent' : 'api',
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
