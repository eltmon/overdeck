/**
 * The link heartbeat (PAN-4645 WI-18, D-4645-7, D-4645-8, NFR-3).
 *
 * Server side: `GET /api/machines/heartbeat` (machine credential only) is a
 * `text/event-stream` with one `heartbeat` event at once, one every 15 s and one
 * right after an event-loop stall of 2 s or more. Data:
 * `{ seq, lastStall: { durationMs, endedAgoMs } | null, endpointsHash, serverVersion }`.
 * Client side: `openHeartbeatOverChannel` sends the request through a secure
 * channel and parses the events; the supervisor consumes them. Both halves share
 * the payload shape and the pure SSE parser here.
 */
import { request as httpRequest } from 'node:http';

import { channelAgent } from '../../../lib/anywhere/channel/channel-agent.js';
import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { getLastEventLoopStall, onEventLoopStall } from './event-loop-monitor.js';

export const HEARTBEAT_EVENT = 'heartbeat';
export const HEARTBEAT_PATH = '/api/machines/heartbeat';
export const HEARTBEAT_SEND_INTERVAL_MS = 15_000;

export interface HeartbeatPayload {
  seq: number;
  lastStall: { durationMs: number; endedAgoMs: number } | null;
  /** SHA-256 (first 16 hex) of this machine's advertised endpoint URLs; '' until WI-19 fills it. */
  endpointsHash: string;
  serverVersion: string;
}

let endpointsHashSource: () => string = () => '';

/** WI-19 registers the endpoint advertiser's hash here. */
export function setHeartbeatEndpointsHashSource(source: (() => string) | null): void {
  endpointsHashSource = source ?? (() => '');
}

/** One heartbeat payload. Pure apart from the stall record and hash sources. */
export function heartbeatPayload(seq: number, serverVersion: string): HeartbeatPayload {
  return { seq, lastStall: getLastEventLoopStall(), endpointsHash: endpointsHashSource(), serverVersion };
}

export function encodeHeartbeatEvent(payload: HeartbeatPayload): string {
  return `event: ${HEARTBEAT_EVENT}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Produce the server stream: an immediate heartbeat, one every 15 s, one after
 * each announced stall. `stop()` ends it.
 */
export function startHeartbeatSource(
  serverVersion: string,
  emit: (chunk: string) => void,
  deps: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval; onStall?: typeof onEventLoopStall } = {},
): { stop: () => void } {
  let seq = 0;
  const send = (): void => {
    seq += 1;
    emit(encodeHeartbeatEvent(heartbeatPayload(seq, serverVersion)));
  };
  send();
  const schedule = deps.setInterval ?? setInterval;
  const timer = schedule(send, HEARTBEAT_SEND_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  const unsubscribe = (deps.onStall ?? onEventLoopStall)(() => send());
  return {
    stop: () => {
      (deps.clearInterval ?? clearInterval)(timer);
      unsubscribe();
    },
  };
}

/** Parse complete SSE events out of a growing buffer; returns the events and the unparsed remainder. */
export function parseSseEvents(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  for (;;) {
    const boundary = rest.indexOf('\n\n');
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

export interface HeartbeatHandlers {
  onHeartbeat: (payload: HeartbeatPayload) => void;
  onEnd: (end: { status?: number; error?: Error }) => void;
}

export interface HeartbeatHandle {
  close(): void;
}

export class HeartbeatOpenError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HeartbeatOpenError';
  }
}

/**
 * Open the peer's heartbeat stream through a channel. Resolves once the 200
 * arrives; rejects with `HeartbeatOpenError` (status) otherwise. Events reach
 * `onHeartbeat`; the end of the stream (or an error) reaches `onEnd` once.
 */
export function openHeartbeatOverChannel(channel: ChannelSocket, token: string, handlers: HeartbeatHandlers): Promise<HeartbeatHandle> {
  return new Promise((resolve, reject) => {
    let opened = false;
    let ended = false;
    const end = (info: { status?: number; error?: Error }): void => {
      if (ended) return;
      ended = true;
      if (opened) handlers.onEnd(info);
    };
    const req = httpRequest(
      {
        method: 'GET',
        path: HEARTBEAT_PATH,
        host: 'link.invalid',
        agent: channelAgent(channel),
        headers: { accept: 'text/event-stream', authorization: `Bearer ${token}` },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.resume();
          reject(new HeartbeatOpenError(status, `heartbeat refused with status ${status}`));
          req.destroy();
          return;
        }
        opened = true;
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parsed = parseSseEvents(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.event !== HEARTBEAT_EVENT) continue;
            try {
              handlers.onHeartbeat(JSON.parse(event.data) as HeartbeatPayload);
            } catch {
              // A malformed event is skipped; the next one carries the state.
            }
          }
        });
        res.on('end', () => end({ status }));
        res.on('error', (error) => end({ status, error }));
        resolve({
          close: () => {
            ended = true;
            req.destroy();
          },
        });
      },
    );
    req.on('error', (error) => {
      if (!opened) reject(error);
      else end({ error });
    });
    req.end();
  });
}
