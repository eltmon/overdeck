import { describe, expect, it } from 'vitest';
import { buildAnthropicMessagesUrl } from '../../src/lib/provider-health.js';

describe('provider health endpoint construction', () => {
  it('appends /v1/messages for provider roots that are not versioned', () => {
    expect(buildAnthropicMessagesUrl('https://api.z.ai/api/anthropic')).toBe(
      'https://api.z.ai/api/anthropic/v1/messages'
    );
  });

  it('appends /messages when the provider base URL already ends in /v1', () => {
    expect(buildAnthropicMessagesUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/messages'
    );
  });

  it('normalizes trailing slashes before appending the messages path', () => {
    expect(buildAnthropicMessagesUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1/messages'
    );
  });
});
