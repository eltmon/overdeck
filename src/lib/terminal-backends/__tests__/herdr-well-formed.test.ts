import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

import { HerdrApiClient, type HerdrSocket } from '../herdr-api.js';
import { pasteAndSubmitHerdrPane } from '../herdr-submit.js';

/**
 * PAN-4506 W3. Herdr's serde_json rejects a lone surrogate with
 * `invalid_request: … unexpected end of hex escape`. These cases pin that
 * every string reaching the wire — via HerdrApiClient.call/stream, and via
 * pasteAndSubmitHerdrPane's paste text — is sanitized first. Node's
 * JSON.parse happily accepts a lone surrogate escape, so "it parses" proves
 * nothing; every assertion here checks the raw written line by regex.
 */

const LONE_HIGH_SURROGATE_ESCAPE = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i;

class FakeSocket extends EventEmitter implements HerdrSocket {
  readonly written: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  end(): void {
    this.destroyed = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  feed(chunk: string): void {
    this.emit('data', Buffer.from(chunk, 'utf-8'));
  }

  connect(): void {
    this.emit('connect');
  }
}

function clientWith(socket: FakeSocket): HerdrApiClient {
  return new HerdrApiClient({ socketPath: '/tmp/fake.sock', connect: () => socket });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HerdrApiClient sanitizes lone surrogates on the wire', () => {
  it('replaces a lone high surrogate in a call() request before it is written', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const text = `review ${'x'.repeat(3990)}\uD83E`;
    const pending = client.call('pane.send_text', { text });
    socket.connect();

    const line = socket.written[0]!;
    expect(line).not.toMatch(LONE_HIGH_SURROGATE_ESCAPE);
    const request = JSON.parse(line) as { id: string; params: { text: string } };
    expect(request.params.text.endsWith('�')).toBe(true);

    socket.feed(`${JSON.stringify({ id: request.id, result: {} })}\n`);
    await pending;
  });

  it('replaces a lone high surrogate in a stream() subscription request before it is written', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const stream = client.stream('events.subscribe', { filter: 'kickoff \uD83E' }, { onEvent: () => {} });
    socket.connect();

    const line = socket.written[0]!;
    expect(line).not.toMatch(LONE_HIGH_SURROGATE_ESCAPE);

    const request = JSON.parse(line) as { id: string };
    socket.feed(`${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`);
    await stream.started;
    stream.close();
  });
});

const RULE = '──────────────────────────────────────────────────────────';
const emptyComposer = [RULE, '❯ ', RULE].join('\n');
const composerWith = (text: string) => [RULE, `❯ ${text}`, RULE].join('\n');

function sequentialScreens(...screens: string[]) {
  let index = 0;
  return () => {
    const screen = screens[Math.min(index, screens.length - 1)]!;
    index += 1;
    return screen;
  };
}

describe('pasteAndSubmitHerdrPane sanitizes the paste text', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('pastes a well-formed string when the raw text carries a lone high surrogate', async () => {
    const sanitized = 'kickoff �';
    const nextScreen = sequentialScreens(composerWith(sanitized), emptyComposer);
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const api = {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === 'pane.read') return { text: nextScreen() };
        if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
        return {};
      },
    };

    const pending = pasteAndSubmitHerdrPane(api, 'p1', 'kickoff \uD83E');
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;

    const paste = calls.find((c) => c.method === 'pane.send_text');
    expect(paste?.params.text).toBe('\x1b[200~kickoff �\x1b[201~');
  });
});
