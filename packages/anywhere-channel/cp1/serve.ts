/**
 * CP-1 responder and page server (PAN-4833 WI-10, D-11).
 *
 * Serves the built harness from `cp1/dist/`, accepts `/channel` WebSockets into the server's real
 * `acceptChannel` (Node port, sodium-native) with a fresh machine key and one pairing code, counts
 * the plaintext bytes the page sends, and writes `done` once 1 MiB has arrived. Pages report their
 * timings by `POST /result`.
 *
 * Run directly to drive another browser (the Android emulator leg):
 *   npx tsx packages/anywhere-channel/cp1/serve.ts --host 0.0.0.0 --port 8791
 * It builds the harness, prints the page URL, prints each result, and exits after the first result
 * or 10 minutes.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'vite';
import { createWebSocketStream, WebSocketServer } from 'ws';

import { acceptChannel } from '../../../src/lib/anywhere/channel/accept.js';
import type { MachineKeyPair } from '../../../src/lib/anywhere/machine-key.js';
import { pairingSecrets } from '../src/noise.js';
import { nodeCrypto } from '../src/crypto-node.js';

export interface Cp1Result {
  engine: string;
  ok: boolean;
  handshakeMs: number;
  transferMs: number;
  error?: string;
}

export interface Cp1Server {
  /** `http://<host>:<port>` as bound. */
  url: string;
  pairingCode: string;
  /** The page URL for a browser that reaches this server at `origin` (default: `url`). */
  pageUrl(origin?: string): string;
  results: AsyncIterable<Cp1Result>;
  close(): Promise<void>;
}

export const CP1_TRANSFER_BYTES = 1_048_576;

const DIST = fileURLToPath(new URL('./dist/', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

/** Build the harness into `cp1/dist/` with Vite. */
export async function buildCp1(): Promise<void> {
  await build({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) });
}

/** A minimal async queue: results pushed by the HTTP handler, consumed with `for await`. */
function resultQueue(): { push(result: Cp1Result): void; end(): void; iterable: AsyncIterable<Cp1Result> } {
  const buffered: Cp1Result[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(result) {
      buffered.push(result);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = buffered.shift();
          if (next) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      },
    },
  };
}

async function serveFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = normalize(new URL(req.url ?? '/', 'http://cp1').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

export async function startCp1Server({ host, port }: { host: string; port: number }): Promise<Cp1Server> {
  const pairingCode = 'odp_' + randomBytes(32).toString('hex');
  const { psk, pairingId } = pairingSecrets(nodeCrypto, pairingCode);
  const localKey = dh.generateKeyPair();
  const queue = resultQueue();

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          queue.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Cp1Result);
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    void serveFile(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://cp1').pathname !== '/channel') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const raw = createWebSocketStream(ws);
      raw.on('error', () => {});
      acceptChannel(raw, {
        localKey,
        isPinnedPeer: () => false,
        takePairing: (id) => (id === pairingId ? { psk } : 'unknown'),
        onPairingFailure: () => {},
      }).then(
        (channel) => {
          let received = 0;
          channel.on('error', () => {});
          channel.on('data', (chunk: Buffer) => {
            const before = received;
            received += chunk.byteLength;
            if (before < CP1_TRANSFER_BYTES && received >= CP1_TRANSFER_BYTES) channel.write(Buffer.from('done', 'ascii'));
          });
        },
        () => raw.destroy(),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const bound = server.address() as AddressInfo;
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${bound.port}`;

  return {
    url,
    pairingCode,
    pageUrl(origin = url) {
      const ws = origin.replace(/^http/, 'ws') + '/channel';
      return `${origin}/?ws=${encodeURIComponent(ws)}&code=${pairingCode}`;
    },
    results: queue.iterable,
    async close() {
      queue.end();
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const host = argValue('--host', '127.0.0.1');
  const port = Number(argValue('--port', '8791'));
  await buildCp1();
  const cp1 = await startCp1Server({ host, port });
  console.log(`CP-1 page: ${cp1.pageUrl()}`);
  console.log(`Pairing code: ${cp1.pairingCode}`);
  const deadline = setTimeout(() => {
    console.log('No result within 10 minutes');
    void cp1.close().then(() => process.exit(1));
  }, 600_000);
  for await (const result of cp1.results) {
    console.log(`CP-1 result: ${JSON.stringify(result)}`);
    clearTimeout(deadline);
    await cp1.close();
    process.exit(result.ok ? 0 : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
