import http from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Callback = (text: string) => void;
  const committed = new Set<Callback>();
  const emitter = {
    onPartial: () => {},
    onCommitted: (cb: Callback) => { committed.add(cb); },
    onError: () => {},
    sendAudio: () => true,
    isAlive: () => true,
    getLastError: () => null,
    // `stop` drives the turn queue's flush without waiting on its debounce timer.
    stop: () => Promise.resolve(),
    close: () => { committed.clear(); },
  };
  return {
    commit: (text: string) => { for (const cb of committed) cb(text); },
    subscribed: () => committed.size > 0,
    emitter,
    processTranscript: vi.fn(() => ({ accepted: false, coalesced: false, snapshot: {} })),
  };
});

vi.mock('../../../voice/transcription-manager.js', () => ({
  createTranscriptionManager: () => ({
    applyCurrent: () => {},
    getActive: () => mocks.emitter,
    close: () => mocks.emitter.close(),
  }),
}));

vi.mock('../../../autopreso/session.js', () => ({
  autoPresoSession: { processTranscript: mocks.processTranscript },
}));

vi.mock('../routes/voice.js', () => ({
  loadVoiceSettings: async () => ({
    stt: { provider: 'moonshine', moonshine: { model: 'base' }, googleCloud: { apiKey: '', model: 'latest_long' } },
    autopreso: { provider: 'openai', model: 'gpt-4.1-mini' },
  }),
  subscribeVoiceSettings: () => () => {},
}));

import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { isAutoPresoSink, setupVoiceWebSocket } from '../ws-voice.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
      resolve(address.port);
    });
  });
}

type ServerMessage = { type: string; text?: string; error?: string };

/** Opens a voice socket, commits one turn, stops, and returns every message received. */
async function runOneTurn(port: number, path: string): Promise<ServerMessage[]> {
  const cookie = dashboardSessionCookieHeader().split(';')[0];
  const client = new WsClient(`ws://127.0.0.1:${port}${path}`, { headers: { origin: TRUSTED_ORIGIN, cookie } });
  const messages: ServerMessage[] = [];
  const finalized = new Promise<void>((resolve, reject) => {
    client.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      messages.push(message);
      if (message.type === 'transcript:finalized') resolve();
    });
    client.once('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });
  // configureTranscription runs after an async settings load; wait for it to subscribe.
  await vi.waitFor(() => expect(mocks.subscribed()).toBe(true));
  mocks.commit('hello there');
  client.send(JSON.stringify({ type: 'stop' }));
  await finalized;
  client.terminate();
  return messages;
}

describe('/ws/voice sink', () => {
  let server: http.Server;

  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    mocks.processTranscript.mockClear();
    server = http.createServer();
    setupVoiceWebSocket(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('reads the sink from the query string', () => {
    const request = (url: string) => ({ url, headers: { host: 'localhost' } }) as http.IncomingMessage;
    expect(isAutoPresoSink(request('/ws/voice?sink=autopreso'))).toBe(true);
    expect(isAutoPresoSink(request('/ws/voice'))).toBe(false);
    expect(isAutoPresoSink(request('/ws/voice?sink=other'))).toBe(false);
  });

  it('does not feed dictation turns to AutoPreso or send its error', async () => {
    const port = await listen(server);
    const messages = await runOneTurn(port, '/ws/voice');
    expect(messages).toContainEqual({ type: 'transcript:committed', text: 'hello there' });
    expect(mocks.processTranscript).not.toHaveBeenCalled();
    expect(messages.some((m) => m.type === 'error')).toBe(false);
  });

  it('feeds turns to AutoPreso when the socket asks for that sink', async () => {
    const port = await listen(server);
    const messages = await runOneTurn(port, '/ws/voice?sink=autopreso');
    expect(mocks.processTranscript).toHaveBeenCalledWith('hello there', expect.anything());
    expect(messages).toContainEqual({ type: 'error', error: 'AutoPreso transcript processing is not live' });
  });
});
