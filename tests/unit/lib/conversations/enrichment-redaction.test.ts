import { describe, expect, it } from 'vitest';
import { buildConversationExcerpt } from '../../../../src/lib/conversations/enrichment/enrich-session.js';

const BOUNDARY = 32 * 1024;
const TOTAL = 64 * 1024 + 1;

function acrossSamplingBoundary(secret: string): string {
  const start = BOUNDARY - 8;
  return `${'x'.repeat(start)}${secret}${'y'.repeat(TOTAL - start - secret.length)}`;
}

function transcriptLine(harness: 'claude-code' | 'pi' | 'codex', text: string): string {
  if (harness === 'pi') {
    return JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } });
  }
  if (harness === 'codex') {
    return JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: text } });
  }
  return JSON.stringify({ message: { role: 'user', content: text } });
}

describe('full-transcript enrichment redaction', () => {
  for (const harness of ['claude-code', 'pi', 'codex'] as const) {
    it(`redacts a GitHub token across the sampling boundary for ${harness}`, () => {
      const token = `ghp_${'A'.repeat(36)}`;
      const excerpt = buildConversationExcerpt(
        [transcriptLine(harness, acrossSamplingBoundary(token))],
        { fullTranscript: true, session: { harness } },
      );

      expect(excerpt).toContain('[REDACTED_TOKEN]');
      expect(excerpt).not.toContain(token.slice(0, 8));
      expect(excerpt).not.toContain(token.slice(9));
    });

    it(`redacts a private key across the sampling boundary for ${harness}`, () => {
      const privateKey = '-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----';
      const excerpt = buildConversationExcerpt(
        [transcriptLine(harness, acrossSamplingBoundary(privateKey))],
        { fullTranscript: true, session: { harness } },
      );

      expect(excerpt).toContain('[REDACTED_PRIVATE_KEY]');
      expect(excerpt).not.toContain('-----BEGIN PRIVATE KEY-----');
      expect(excerpt).not.toContain('secret-material');
      expect(excerpt).not.toContain('-----END PRIVATE KEY-----');
    });
  }
});
