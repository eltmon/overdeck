import Anthropic from '@anthropic-ai/sdk';
import { modelSupportsSamplingParams } from '../../model-capabilities.js';
import {
  buildJsonExtractionPrompt,
  calculateExtractionCost,
  parseJsonPayload,
  recordExtractionCost,
  ExtractionProviderAuthError,
  type ExtractionProvider,
  type ExtractionProviderOptions,
  type ExtractionProviderResult,
  type ExtractionUsage,
} from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function hasAnthropicEnvCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export class AnthropicExtractionProvider implements ExtractionProvider {
  readonly name = 'anthropic';
  readonly defaultModel = DEFAULT_MODEL;

  private defaultClient: Anthropic | null = null;

  constructor(
    private readonly client?: Anthropic,
    private readonly hasCredentials: () => boolean = hasAnthropicEnvCredentials,
  ) {}

  async extract<T>(
    prompt: string,
    jsonSchema: unknown,
    options: ExtractionProviderOptions = {},
  ): Promise<ExtractionProviderResult<T>> {
    let client = this.client;
    if (!client) {
      if (!this.hasCredentials()) {
        throw new ExtractionProviderAuthError(this.name, 'no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in this process environment');
      }
      client = this.defaultClient ??= new Anthropic();
    }

    const model = options.model ?? this.defaultModel;
    let response;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: options.maxTokens ?? 2048,
          // Sampling-restricted models (Sonnet 5+, Opus 4.7+, Fable) 400 on temperature (PAN-4327).
          ...(modelSupportsSamplingParams(model) ? { temperature: options.temperature ?? 0 } : {}),
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
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ExtractionProviderAuthError(this.name, error.message, { cause: error });
      }
      throw error;
    }

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
