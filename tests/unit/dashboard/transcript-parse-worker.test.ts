import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Stream } from 'effect';

import { runDashboardDbJob } from '../../../src/dashboard/server/services/dashboard-db-task.js';
import { parseEntireConversation, type ParseResult } from '../../../src/dashboard/server/services/conversation-service.js';
import { parseCodexConversationMessages } from '../../../src/dashboard/server/services/codex-conversation-parser.js';
import { parsePiConversationMessages } from '../../../src/dashboard/server/services/pi-conversation-parser.js';
import { streamResolvedFullParseSnapshots } from '../../../src/dashboard/server/ws-rpc.js';

const claudeFixture = new URL(
  '../../../src/dashboard/server/services/__fixtures__/misordered-session.jsonl',
  import.meta.url,
);
const piFixture = new URL(
  '../../../src/dashboard/server/services/__tests__/pi-conversation-parser.fixture.jsonl',
  import.meta.url,
);
const codexFixture = new URL(
  '../../../src/lib/cost-parsers/__tests__/fixtures/codex/rollout.jsonl',
  import.meta.url,
);
const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../../src/dashboard/server/services/dashboard-db-task.js');
  vi.doUnmock('../../../src/dashboard/server/routes/jsonl-resolver.js');
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('transcript parse worker routing', () => {
  it('dispatches every full-snapshot harness stream through the parse job door', async () => {
    vi.resetModules();
    const jobSpy = vi.fn<(operation: string, payload: unknown) => Promise<ParseResult>>(
      async () => parsePiConversationMessages(piFixture.pathname),
    );
    vi.doMock('../../../src/dashboard/server/services/dashboard-db-task.js', () => ({
      runDashboardDbJob: jobSpy,
    }));
    vi.doMock('../../../src/dashboard/server/routes/jsonl-resolver.js', () => ({
      resolveAgentHarness: vi.fn(async () => 'claude-code'),
      resolvePiSessionPath: vi.fn(async () => piFixture.pathname),
      resolveCodexRolloutPath: vi.fn(async () => piFixture.pathname),
      resolveAcpTranscriptPath: vi.fn(async () => piFixture.pathname),
      resolveKimiWirePath: vi.fn(async () => piFixture.pathname),
      readLauncherPinnedSessionId: vi.fn(async () => null),
    }));
    const { streamHarnessFullParseSnapshots: isolatedStreamHarness } = await import(
      '../../../src/dashboard/server/ws-rpc.js'
    );

    for (const harness of ['pi', 'ohmypi', 'codex', 'acp', 'kimi-code']) {
      const stream = isolatedStreamHarness(`session-${harness}`, harness, null);
      await Effect.runPromise(stream!.pipe(Stream.take(1), Stream.runCollect));
    }

    expect(jobSpy.mock.calls.map(([, payload]) => (payload as { parser: string }).parser)).toEqual([
      'pi', 'ohmypi', 'codex', 'acp', 'kimi',
    ]);
    expect(jobSpy.mock.calls.every(([operation]) => operation === 'parseTranscriptSnapshot')).toBe(true);
  });

  it.each([
    ['claude-initial', claudeFixture, (file: string) => parseEntireConversation(file, { flushPendingToolUse: false })],
    ['pi', piFixture, parsePiConversationMessages],
    ['codex', codexFixture, parseCodexConversationMessages],
  ] as const)('matches the direct %s parser', async (parser, fixture, directParse) => {
    const expected = await directParse(fixture.pathname);
    const actual = await runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', {
      sessionFile: fixture.pathname,
      parser,
    });

    expect(actual).toEqual(expected);
  });

  it('parses a generated transcript larger than 20 MB without losing its message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'large-transcript-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');
    const text = 'x'.repeat(20 * 1024 * 1024);
    writeFileSync(sessionFile, `${JSON.stringify({
      type: 'message',
      id: 'large-message',
      timestamp: '2026-08-16T00:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text }] },
    })}\n`);
    expect(statSync(sessionFile).size).toBeGreaterThanOrEqual(20 * 1024 * 1024);

    const result = await runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', {
      sessionFile,
      parser: 'pi',
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text).toHaveLength(text.length);
  });

  it('preserves the full snapshot wire shape when parsing through the job door', async () => {
    const direct = await Effect.runPromise(
      streamResolvedFullParseSnapshots(
        async () => piFixture.pathname,
        parsePiConversationMessages,
        null,
      ).pipe(Stream.take(1), Stream.runCollect),
    );
    const jobBacked = await Effect.runPromise(
      streamResolvedFullParseSnapshots(
        async () => piFixture.pathname,
        file => runDashboardDbJob('parseTranscriptSnapshot', { sessionFile: file, parser: 'pi' }),
        null,
      ).pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(jobBacked)).toEqual(Array.from(direct));
  });
});
