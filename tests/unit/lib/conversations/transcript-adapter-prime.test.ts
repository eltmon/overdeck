import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getTranscriptAdapter } from '../../../../src/lib/conversations/transcript-adapter.js';

const fixture = fileURLToPath(new URL('../../../fixtures/prime-agent/session.jsonl', import.meta.url));

describe('Prime Agent transcript adapter', () => {
  it('is registered under the Prime harness', () => {
    expect(getTranscriptAdapter('prime-agent').name).toBe('prime-agent');
  });

  it('normalizes every durable Prime record kind', async () => {
    const transcript = await getTranscriptAdapter('prime-agent').serializeTranscript(fixture);
    expect(transcript).toContain('[user]\nRun the analysis');
    expect(transcript).toContain('[thinking]\nI should inspect the data first');
    expect(transcript).toContain('[assistant]\nI will inspect it.');
    expect(transcript).toContain('[tool_use: python]');
    expect(transcript).toContain('[tool]\n42');
    expect(transcript).toContain('[compaction]\nEarlier analysis was compacted.');
    expect(transcript).toContain('[error]\nPython process exited');
  });

  it('bounds large tool output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prime-transcript-'));
    const path = join(dir, 'session.jsonl');
    await writeFile(path, `${JSON.stringify({ type: 'tool_result', result: 'x'.repeat(20_000) })}\n`);
    try {
      const transcript = await getTranscriptAdapter('prime-agent').serializeTranscript(path);
      expect(transcript.length).toBeLessThan(4_100);
      expect(transcript).toMatch(/…$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
