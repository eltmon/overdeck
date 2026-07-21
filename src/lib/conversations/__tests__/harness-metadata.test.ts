import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AcpTranscriptEntry } from '../../acp/transcript.js';
import { parseAcpSessionMetadata } from '../harness-metadata.js';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('parseAcpSessionMetadata', () => {
  it('extracts the ACP session ID, timestamps, message count, and tool names', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-acp-metadata-'));
    const transcriptPath = join(tempDir, 'acp-session.jsonl');
    const entries: AcpTranscriptEntry[] = [
      {
        timestamp: '2026-07-18T10:00:00.000Z',
        role: 'user',
        content: 'Inspect the repository.',
        sessionId: 'acp-session-1',
        source: 'orchestrator',
      },
      {
        timestamp: '2026-07-18T10:00:01.000Z',
        role: 'tool',
        content: 'Read package.json',
        sessionId: 'acp-session-1',
        source: 'agent',
        toolCalls: [
          {
            toolCallId: 'tool-1',
            kind: 'read_file',
            title: 'Read',
            status: 'completed',
            data: {},
          },
        ],
      },
      {
        timestamp: '2026-07-18T10:00:02.000Z',
        role: 'assistant',
        content: 'The repository is ready.',
        sessionId: 'acp-session-1',
        source: 'agent',
      },
    ];
    writeFileSync(
      transcriptPath,
      `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n{not-json\n`,
      'utf8',
    );

    const metadata = await parseAcpSessionMetadata(transcriptPath);

    expect(metadata).toMatchObject({
      sessionId: 'acp-session-1',
      messageCount: 3,
      firstTs: '2026-07-18T10:00:00.000Z',
      lastTs: '2026-07-18T10:00:02.000Z',
      toolsUsed: ['Read'],
      modelsUsed: [],
      primaryModel: null,
    });
  });
});
