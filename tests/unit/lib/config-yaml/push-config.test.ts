import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../../../src/lib/config-yaml.js';
import { defaultPushConfig } from '../../../../src/lib/config-yaml/push-config.js';
import type { PushYamlConfig } from '../../../../src/lib/config-yaml/push-config.js';

function pushFrom(push: PushYamlConfig) {
  return mergeConfigs({ push }).config.push;
}

describe('config-yaml push block (PAN-2354)', () => {
  it('defaults when the block is absent', () => {
    const { config } = mergeConfigs(null);
    expect(config.push).toEqual({
      enabled: true,
      events: ['question', 'approval', 'finished', 'failed'],
      includePreview: false,
      webpush: { subject: 'https://overdeck.ai' },
      ntfy: { state: 'off' },
    });
    expect(config.push).toEqual(defaultPushConfig());
  });

  it('drops invalid events entries', () => {
    expect(pushFrom({ events: ['question', 'bogus'] }).events).toEqual(['question']);
  });

  it('leaves ntfy off when url and topic are both absent', () => {
    expect(pushFrom({ ntfy: {} }).ntfy).toEqual({ state: 'off' });
  });

  it('is misconfigured with reason "topic missing" when only url is set', () => {
    expect(pushFrom({ ntfy: { url: 'https://ntfy.example.net' } }).ntfy).toEqual({
      state: 'misconfigured',
      reason: 'topic missing',
    });
  });

  it('is misconfigured for an ftp: url or a topic with a space', () => {
    expect(pushFrom({ ntfy: { url: 'ftp://ntfy.example.net', topic: 'deck' } }).ntfy.state).toBe('misconfigured');
    expect(pushFrom({ ntfy: { url: 'https://ntfy.example.net', topic: 'has space' } }).ntfy.state).toBe('misconfigured');
  });

  it('is ready with null token and clickBaseUrl when those are omitted', () => {
    expect(pushFrom({ ntfy: { url: 'https://ntfy.example.net', topic: 'deck-k3J9' } }).ntfy).toEqual({
      state: 'ready',
      url: 'https://ntfy.example.net',
      topic: 'deck-k3J9',
      token: null,
      clickBaseUrl: null,
    });
  });

  it('preserves includePreview: true', () => {
    expect(pushFrom({ includePreview: true }).includePreview).toBe(true);
  });

  it('never throws on a malformed block', () => {
    expect(() => mergeConfigs({ push: 'nonsense' as unknown as PushYamlConfig })).not.toThrow();
    expect(() => pushFrom({ events: 'question' as unknown as string[], ntfy: [] as unknown as PushYamlConfig['ntfy'] })).not.toThrow();
  });

  it('does not share the push object between merges', () => {
    const first = mergeConfigs({ push: { events: ['failed'] } }).config.push;
    const second = mergeConfigs(null).config.push;
    expect(first.events).toEqual(['failed']);
    expect(second.events).toEqual(['question', 'approval', 'finished', 'failed']);
  });
});
