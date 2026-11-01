/**
 * The link heartbeat (PAN-4645 WI-18, D-4645-7, D-4645-8, NFR-3).
 *
 * Server side: `GET /api/machines/heartbeat` (machine credential only) is a
 * `text/event-stream` with one `heartbeat` event at once, one every 15 s and one
 * right after an event-loop stall of 2 s or more. Data:
 * `{ seq, lastStall: { durationMs, endedAgoMs } | null, endpointsHash, serverVersion, conversationsHash?, load?, tags?, placement?, projectsHash?, needsYouHash? }`.
 * Client side: `openHeartbeatOverChannel` sends the request through a secure
 * channel and parses the events; the supervisor consumes them. Both halves share
 * the payload shape and the pure SSE parser here.
 */
import { request as httpRequest } from 'node:http';

import type { LoadSample, MachinePlacementMode } from '@overdeck/contracts';

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
  /** PAN-4650 D-4650-2: hash of this machine's shared conversation list; absent from older peers. */
  conversationsHash?: string;
  /** PAN-4651 D-4651-8: this machine's last load sample; absent from older peers. */
  load?: LoadSample;
  /** PAN-4651 D-4651-8: capability tags (never in the public descriptor). */
  tags?: string[];
  placement?: MachinePlacementMode;
  /** PAN-4651 D-4651-11: hash of this machine's project list (`GET /api/machines/projects`). */
  projectsHash?: string;
  /** PAN-4651 D-4651-15: hash of this machine's Needs-You feed (`GET /api/machines/needs-you`). */
  needsYouHash?: string;
}

/** The machine facts a beat carries; every field optional (absent until first sampled). */
export type HeartbeatMachineFacts = Pick<HeartbeatPayload, 'load' | 'tags' | 'placement' | 'projectsHash' | 'needsYouHash'>;

let endpointsHashSource: () => string = () => '';
let machineFactsSource: () => HeartbeatMachineFacts = () => ({});
let conversationsHashSource: (() => Promise<string>) | null = null;
let lastConversationsHash: string | undefined;
/**
 * Longest a heartbeat waits for the conversation list hash. The peer flags a
 * beat later than 17.5 s as a network stall, so a slow list build must never
 * hold one back: past this wait the beat carries the last known hash.
 */
export const HEARTBEAT_HASH_WAIT_MS = 1_000;

/** WI-19 registers the endpoint advertiser's hash here. */
export function setHeartbeatEndpointsHashSource(source: (() => string) | null): void {
  endpointsHashSource = source ?? (() => '');
}

/** PAN-4651 registers the load sampler and capability profile here; synchronous, so a beat never waits on it. */
export function setHeartbeatMachineFactsSource(source: (() => HeartbeatMachineFacts) | null): void {
  machineFactsSource = source ?? (() => ({}));
}

/** PAN-4650 registers the shared conversation list's hash here; null leaves it out. */
export function setHeartbeatConversationsHashSource(source: (() => Promise<string>) | null): void {
  conversationsHashSource = source;
  lastConversationsHash = undefined;
}

/** The conversations hash for one beat: fresh within `HEARTBEAT_HASH_WAIT_MS`, else the last known one. */
function conversationsHashForBeat(source: () => Promise<string>): Promise<string | undefined> {
  const fresh = source().then(
    (hash) => {
      lastConversationsHash = hash;
      return hash;
    },
    () => lastConversationsHash,
  );
  let timer: NodeJS.Timeout | undefined;
  const fallback = new Promise<string | undefined>((resolve) => {
    timer = setTimeout(() => resolve(lastConversationsHash), HEARTBEAT_HASH_WAIT_MS);
  });
  return Promise.race([fresh, fallback]).finally(() => clearTimeout(timer));
}

/** One heartbeat payload. Pure apart from the stall record and hash sources. */
export function heartbeatPayload(seq: number, serverVersion: string): HeartbeatPayload {
  return { seq, lastStall: getLastEventLoopStall(), endpointsHash: endpointsHashSource(), serverVersion, ...machineFactsSource() };
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
  let stopped = false;
  const send = (): void => {
    seq += 1;
    const payload = heartbeatPayload(seq, serverVersion);
    const hashSource = conversationsHashSource;
    if (!hashSource) {
      emit(encodeHeartbeatEvent(payload));
      return;
    }
    // A slow or failed list build still sends the beat, with the last known hash or none.
    void conversationsHashForBeat(hashSource).then((conversationsHash) => {
      if (stopped) return;
      emit(encodeHeartbeatEvent(conversationsHash === undefined ? payload : { ...payload, conversationsHash }));
    });
  };
  send();
  const schedule = deps.setInterval ?? setInterval;
  const timer = schedule(send, HEARTBEAT_SEND_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  const unsubscribe = (deps.onStall ?? onEventLoopStall)(() => send());
  return {
    stop: () => {
      stopped = true;
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
