import { CLIPROXY_AUTH_TOKEN, CLIPROXY_BASE_URL } from '../../src/lib/cliproxy.js';
import type { EvalModelConfig } from './eval-model.js';
import { usageFromOpenAI, type EvalUsage, type OpenAIUsageLike } from './eval-usage.js';

export const OPENAI_API_BASE_URL = 'https://api.openai.com';

export interface OpenAIResponsesCall {
  text: string;
  usage: EvalUsage;
  stopReason: string | null;
}

interface OpenAIResponsesBody {
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  incomplete_details?: { reason?: string | null } | null;
  status?: string | null;
  usage?: OpenAIUsageLike;
  error?: { message?: string; code?: string } | null;
}

export async function callOpenAIResponses(
  config: EvalModelConfig,
  prompt: { system: string; user: string },
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenAIResponsesCall> {
  const base = config.openaiVia === 'cliproxy' ? CLIPROXY_BASE_URL : OPENAI_API_BASE_URL;
  const token = config.openaiVia === 'cliproxy' ? CLIPROXY_AUTH_TOKEN : env['OPENAI_API_KEY'];

  const body: Record<string, unknown> = {
    model: config.apiModel,
    instructions: prompt.system,
    input: [{ role: 'user', content: prompt.user }],
    max_output_tokens: config.maxTokens,
    ...(config.effort !== null ? { reasoning: { effort: config.effort } } : {}),
  };

  const response = await fetchImpl(`${base}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as OpenAIResponsesBody;

  if (!response.ok || json.error) {
    throw new Error(
      `OpenAI Responses call for "${config.model}" via ${config.openaiVia} failed (HTTP ${response.status}): ${json.error?.message ?? response.statusText}`,
    );
  }

  const text = (json.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('\n');

  const stopReason = json.incomplete_details?.reason ?? json.status ?? null;

  if (!json.usage) {
    throw new Error(`OpenAI Responses call for "${config.model}" returned no usage`);
  }
  const usage = usageFromOpenAI(json.usage);

  return { text, usage, stopReason };
}
