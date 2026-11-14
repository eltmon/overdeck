/**
 * PAN-5232 FR-3, D5: pin the herdr 0.9.1 `pane.read` wire shape through the
 * real `HerdrApiClient`, not through a mocked `.call()`. Case 1 feeds the
 * exact 0.9.1 NDJSON line and proves `call()` returns `result` unchanged
 * while `readHerdrPaneText` still gets the text. Case 2 proves
 * `pasteAndSubmitHerdrPane` reads that same wire shape end to end. Case 3
 * pins the committed schema fixture against the shape this module assumes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { HerdrApiClient, type HerdrSocket } from '../../../../src/lib/terminal-backends/herdr-api.js';
import { readHerdrPaneText } from '../../../../src/lib/terminal-backends/herdr.js';
import { pasteAndSubmitHerdrPane } from '../../../../src/lib/terminal-backends/herdr-submit.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const SCHEMA_FIXTURE_PATH = join(
  repoRoot, 'src', 'lib', 'terminal-backends', '__fixtures__', 'herdr-v0.9.1', 'schema.json',
);

/** A fake connection: one request per connection, exactly as herdr-api.ts expects. */
class FakeConnection extends EventEmitter implements HerdrSocket {
  constructor(private readonly respond: (line: string) => string) {
    super();
  }

  write(data: string): boolean {
    queueMicrotask(() => this.emit('data', Buffer.from(`${this.respond(data)}\n`)));
    return true;
  }

  end(): void {}
  destroy(): void {}

  connect(): void {
    queueMicrotask(() => this.emit('connect'));
  }
}

/** Builds a client whose connections are answered by `respond(requestLine)`. */
function fakeClient(respond: (line: string) => string): HerdrApiClient {
  return new HerdrApiClient({
    socketPath: '/dev/null',
    connect: () => {
      const socket = new FakeConnection(respond);
      socket.connect();
      return socket;
    },
  });
}

describe('herdr pane.read wire contract (PAN-5232)', () => {
  it('readHerdrPaneText resolves the 0.9.1 read.text, and call() leaves result unwrapped', async () => {
    const cannedText = '  ⏵⏵ bypass permissions on · ...\n';
    const client = fakeClient((line) => {
      const { id } = JSON.parse(line) as { id: string };
      return JSON.stringify({
        id,
        result: {
          type: 'pane_read',
          read: {
            pane_id: 'w2:p7C',
            workspace_id: 'w2',
            tab_id: 'w2:t5B',
            source: 'recent',
            format: 'text',
            text: cannedText,
            revision: 0,
            truncated: true,
          },
        },
      });
    });

    await expect(readHerdrPaneText('w2:p7C', 1, 'recent', client)).resolves.toBe(cannedText);

    const raw = await client.call<{ text?: unknown; read?: { text?: unknown } }>('pane.read', {
      pane_id: 'w2:p7C', source: 'recent', lines: 1, strip_ansi: true,
    });
    expect(raw.text).toBeUndefined();
    expect(raw.read?.text).toBe(cannedText);
  });

  it('pasteAndSubmitHerdrPane reads the composer through the 0.9.1 shape and reports submitted', async () => {
    const text = 'hello world';
    const RULE = '──────────────────────────────────────────────────────────';
    const composerWithPayload = [RULE, `❯ ${text}`, RULE].join('\n');
    const emptyComposer = [RULE, '❯ ', RULE].join('\n');
    let sentKeys = false;

    const client = fakeClient((line) => {
      const { id, method } = JSON.parse(line) as { id: string; method: string };
      if (method === 'pane.read') {
        return JSON.stringify({
          id,
          result: { type: 'pane_read', read: { text: sentKeys ? emptyComposer : composerWithPayload } },
        });
      }
      if (method === 'agent.get') {
        return JSON.stringify({ id, result: { type: 'agent_info', agent: { agent_status: 'idle' } } });
      }
      if (method === 'pane.send_keys') sentKeys = true;
      return JSON.stringify({ id, result: { type: 'ok' } });
    });

    let clock = 0;
    const outcome = await pasteAndSubmitHerdrPane(client, 'w2:p7C', text, 'enter', {
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });

    expect(outcome).toBe('submitted');
  });

  it('the committed schema fixture pins the pane_read variant and PaneReadResult.required', async () => {
    interface ResponseResultVariant { properties: Record<string, { const?: string; $ref?: string }> }
    const fixture = JSON.parse(await readFile(SCHEMA_FIXTURE_PATH, 'utf-8')) as {
      schemas: {
        success_response: {
          $defs: {
            ResponseResult: { oneOf: ResponseResultVariant[] };
            PaneReadResult: { required: string[] };
          };
        };
      };
    };
    const defs = fixture.schemas.success_response.$defs;
    const paneReadVariant = defs.ResponseResult.oneOf.find(
      (variant) => variant.properties['type']?.const === 'pane_read',
    );
    expect(paneReadVariant).toBeDefined();
    expect(Object.keys(paneReadVariant!.properties).filter((key) => key !== 'type')).toEqual(['read']);
    expect(paneReadVariant!.properties['read']?.$ref).toMatch(/\/PaneReadResult$/);
    expect(defs.PaneReadResult.required).toContain('text');
  });
});
