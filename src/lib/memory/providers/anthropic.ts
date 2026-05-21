import Anthropic from '@anthropic-ai/sdk';
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

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export class AnthropicExtractionProvider implements ExtractionProvider {
  readonly name = 'anthropic';
  readonly defaultModel = DEFAULT_MODEL;

  constructor(private readonly client = new Anthropic()) {}

  async extract<T>(
    prompt: string,
    jsonSchema: unknown,
    options: ExtractionProviderOptions = {},
  ): Promise<ExtractionProviderResult<T>> {
    const model = options.model ?? this.defaultModel;
    const response = await this.client.messages.create(
      {
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildJsonExtractionPrompt(prompt, jsonSchema),
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      },
      { signal: options.signal },
    );

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const usage: ExtractionUsage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };
    const cost = calculateExtractionCost(this.name, model, usage);
    const requestId = `anthropic-${response.id}`;

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
