import { CLIPROXY_AUTH_TOKEN, CLIPROXY_BASE_URL } from '../../cliproxy.js';
import {
  buildJsonExtractionPrompt,
  calculateExtractionCost,
  parseJsonPayload,
  recordExtractionCost,
  type ExtractionProvider,
  type ExtractionProviderOptions,
  type ExtractionProviderResult,
  type ExtractionUsage,
} from './types.js';

const DEFAULT_MODEL = 'gpt-4.1-nano';

type FetchFn = typeof fetch;

interface AnthropicCompatibleResponse {
  id?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export class CliproxyExtractionProvider implements ExtractionProvider {
  readonly name = 'cliproxy';
  readonly defaultModel = DEFAULT_MODEL;

  constructor(
    private readonly baseUrl = CLIPROXY_BASE_URL,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async extract<T>(
    prompt: string,
    jsonSchema: unknown,
    options: ExtractionProviderOptions = {},
  ): Promise<ExtractionProviderResult<T>> {
    const model = options.model ?? this.defaultModel;
    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': CLIPROXY_AUTH_TOKEN,
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0,
        messages: [{ role: 'user', content: buildJsonExtractionPrompt(prompt, jsonSchema) }],
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`cliproxy extraction failed: HTTP ${response.status}`);
    }

    const body = await response.json() as AnthropicCompatibleResponse;
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    const usage: ExtractionUsage = {
      input: body.usage?.input_tokens ?? 0,
      output: body.usage?.output_tokens ?? 0,
      cacheRead: body.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: body.usage?.cache_creation_input_tokens ?? 0,
    };
    const cost = calculateExtractionCost(this.name, model, usage);
    const requestId = body.id ? `cliproxy-${body.id}` : undefined;

    recordExtractionCost({ provider: this.name, model, usage, cost, identity: options.identity, requestId });

    return {
      data: parseJsonPayload<T>(text),
      usage,
      cost,
      model,
      provider: this.name,
      requestId,
    };
  }
}
