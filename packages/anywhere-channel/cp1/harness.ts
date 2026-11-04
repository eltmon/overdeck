/**
 * CP-1 harness page (PAN-4833 WI-10): pair with the local responder through `openSecureChannel`
 * on the web crypto port and pure-JS libsodium, send 1 MiB, and report the timings.
 */
import dh from 'noise-handshake/dh';

import { openSecureChannel } from '../src/secure-channel-web.js';
import { WsDuplex } from './ws-duplex.js';

interface Cp1Result {
  engine: string;
  ok: boolean;
  handshakeMs: number;
  transferMs: number;
  error?: string;
}

const CHUNK_BYTES = 16 * 1024;
const CHUNKS = 64;

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(`WebSocket to ${url} failed`)), { once: true });
  });
}

async function run(): Promise<Cp1Result> {
  const params = new URLSearchParams(location.search);
  const wsUrl = params.get('ws');
  const code = params.get('code');
  if (!wsUrl || !code) throw new Error('missing ws or code query parameter');

  const raw = new WsDuplex(await openSocket(wsUrl));
  const localKey = (dh as { generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } }).generateKeyPair();
  const t0 = performance.now();
  const { stream } = await openSecureChannel(raw, { mode: 'pairing', pairingCode: code, localKey }, 'cp1');
  const handshakeMs = performance.now() - t0;

  const t1 = performance.now();
  const done = new Promise<void>((resolve, reject) => {
    let seen = 0;
    stream.on('data', (chunk: unknown) => {
      seen += (chunk as Uint8Array).byteLength;
      if (seen >= 4) resolve();
    });
    stream.on('error', (error: unknown) => reject(error as Error));
    stream.on('close', () => reject(new Error('secure channel closed before the responder said done')));
  });
  const chunk = new Uint8Array(CHUNK_BYTES);
  for (let i = 0; i < CHUNKS; i++) stream.write(chunk);
  await done;
  const transferMs = performance.now() - t1;
  stream.destroy();
  return { engine: navigator.userAgent, ok: true, handshakeMs, transferMs };
}

async function report(result: Cp1Result): Promise<void> {
  const text = JSON.stringify(result);
  try {
    await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
  } finally {
    const pre = document.getElementById('result');
    if (pre) pre.textContent = text;
  }
}

run()
  .catch((error: unknown): Cp1Result => ({
    engine: navigator.userAgent,
    ok: false,
    handshakeMs: -1,
    transferMs: -1,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }))
  .then(report);
