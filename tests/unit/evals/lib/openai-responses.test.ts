import { describe, expect, it, vi } from 'vitest';
import { callOpenAIResponses, OPENAI_API_BASE_URL } from '../../../../evals/lib/openai-responses.js';
import type { EvalModelConfig } from '../../../../evals/lib/eval-model.js';

function baseConfig(overrides: Partial<EvalModelConfig> = {}): EvalModelConfig {
  return {
    model: 'gpt-6-luna',
    catalogId: 'gpt-6-luna',
    apiModel: 'gpt-6-luna',
    provider: 'openai',
    effort: 'high',
    thinking: null,
    temperature: null,
    maxTokens: 128000,
    openaiVia: 'api',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

describe('callOpenAIResponses', () => {
  it('posts to api.openai.com with the OPENAI_API_KEY bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    await callOpenAIResponses(baseConfig({ openaiVia: 'api' }), { system: 'sys', user: 'usr' }, { OPENAI_API_KEY: 'sk-test' }, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${OPENAI_API_BASE_URL}/v1/responses`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('posts to CLIProxy with the local token when openaiVia is cliproxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    await callOpenAIResponses(baseConfig({ openaiVia: 'cliproxy' }), { system: 'sys', user: 'usr' }, {}, fetchMock);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8317/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer overdeck-local-cliproxy-key');
  });

  it('body maps effort to reasoning.effort and sends no temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    await callOpenAIResponses(
      baseConfig({ openaiVia: 'api', effort: 'high', maxTokens: 128000 }),
      { system: 'sys prompt', user: 'usr prompt' },
      { OPENAI_API_KEY: 'sk-test' },
      fetchMock,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.instructions).toBe('sys prompt');
    expect(body.input).toEqual([{ role: 'user', content: 'usr prompt' }]);
    expect(body.max_output_tokens).toBe(128000);
    expect(body).not.toHaveProperty('temperature');
  });

  it('joins output_text parts and returns usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }, { type: 'output_text', text: 'world' }] }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );

    const result = await callOpenAIResponses(baseConfig(), { system: 'sys', user: 'usr' }, { OPENAI_API_KEY: 'sk-test' }, fetchMock);

    expect(result.text).toBe('hello\nworld');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 2 });
    expect(result.stopReason).toBe('completed');
  });

  it('rejects with the model id and provider message on model_not_found', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: 'unknown provider for model gpt-6-sol', code: 'model_not_found' } }, false, 400, 'Bad Request'),
    );

    await expect(
      callOpenAIResponses(baseConfig({ model: 'gpt-6-sol', apiModel: 'gpt-6-sol' }), { system: 'sys', user: 'usr' }, { OPENAI_API_KEY: 'sk-test' }, fetchMock),
    ).rejects.toThrow(/gpt-6-sol.*unknown provider/s);
  });
});
