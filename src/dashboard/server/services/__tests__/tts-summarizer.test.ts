import { describe, expect, it } from 'vitest';
import { buildSummarizerRequestBody, type ActivityItem } from '../tts-summarizer.js';

const items: ActivityItem[] = [
  { source: 'test', level: 'info', message: 'PAN-4327 tests passed', timestamp: new Date().toISOString() },
  { source: 'test', level: 'info', message: 'PAN-4327 pushed', timestamp: new Date().toISOString() },
];

describe('buildSummarizerRequestBody (PAN-4327)', () => {
  it('sends temperature for a model that accepts sampling params', () => {
    const body = buildSummarizerRequestBody('gpt-5.4-mini', items);
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(80);
    expect(body.messages).toHaveLength(2);
  });

  it('omits temperature for a sampling-restricted model', () => {
    const body = buildSummarizerRequestBody('claude-sonnet-5-5', items);
    expect(body).not.toHaveProperty('temperature');
    expect(body.max_tokens).toBe(80);
    expect(body.messages).toHaveLength(2);
  });
});
