/**
 * Records every signaling message a local Overdeck server exchanges with the share service, and checks
 * the record for content (PRD PAN-4482 WI-2).
 *
 * `SignalingCapture` wraps the injected seams `ShareManagerDeps.openSocket`, `JoinManagerDeps.openSocket`,
 * `createRoom` and `deleteRoom`, so it records decoded text at the message layer with no network change.
 * (A raw TCP logger would miss every client-to-server canary: RFC 6455 masks those frames.) Everything
 * stays in memory. `findLeaks` scans the record for planted canaries; `frameViolations` checks every
 * frame against the documented protocol (`packages/contracts/src/sharing.ts`); `summarize` counts the
 * frames that prove the capture sat on the live path. Neither checker ever puts a scanned value in its
 * report, so no TURN credential reaches an assertion message.
 */
import type { RawData } from 'ws';
import type { ShareManagerDeps, ShareSocket } from '../../../src/dashboard/server/services/share-host.js';
import { createRoom, deleteRoom } from '../../../src/lib/sharing/share-service.js';

export type SocketRole = 'host' | 'viewer';
export type Direction = 'to-service' | 'from-service';

export type CaptureEntry =
  | { readonly kind: 'ws-text'; readonly role: SocketRole; readonly label: string; readonly direction: Direction; readonly text: string }
  | { readonly kind: 'ws-binary'; readonly role: SocketRole; readonly label: string; readonly direction: Direction; readonly bytes: number }
  | { readonly kind: 'ws-close'; readonly role: SocketRole; readonly label: string; readonly code: number }
  | { readonly kind: 'http'; readonly method: string; readonly path: string; readonly status: number; readonly requestBody: string; readonly responseBody: string };

type OpenSocket = ShareManagerDeps['openSocket'];

function rawToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}

export class SignalingCapture {
  readonly entries: CaptureEntry[] = [];

  /** Wraps `open` (normally `defaultOpenSocket`): records every `send(text)` and every `message` and `close` event. */
  openSocket(role: SocketRole, label: string, open: OpenSocket): OpenSocket {
    return (url, headers) => {
      const socket: ShareSocket = open(url, headers);
      const send = socket.send.bind(socket) as (...args: unknown[]) => void;
      socket.send = ((...args: unknown[]) => {
        this.entries.push({ kind: 'ws-text', role, label, direction: 'to-service', text: String(args[0]) });
        send(...args);
      }) as ShareSocket['send'];
      socket.on('message', (data, isBinary) => {
        const buffer = rawToBuffer(data);
        if (isBinary) this.entries.push({ kind: 'ws-binary', role, label, direction: 'from-service', bytes: buffer.byteLength });
        else this.entries.push({ kind: 'ws-text', role, label, direction: 'from-service', text: buffer.toString('utf8') });
      });
      socket.on('close', (code) => {
        this.entries.push({ kind: 'ws-close', role, label, code });
      });
      return socket;
    };
  }

  private readonly recordingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    this.entries.push({
      kind: 'http',
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      status: res.status,
      requestBody: String(init?.body ?? ''),
      responseBody: await res.clone().text(),
    });
    return res;
  }) as typeof fetch;

  /** `createRoom` with a recording `fetch` passed through its `opts.fetch` parameter. */
  readonly createRoom: typeof createRoom = (base, token, scope) => createRoom(base, token, scope, { fetch: this.recordingFetch });

  /** `deleteRoom` with a recording `fetch` passed through its `opts.fetch` parameter. */
  readonly deleteRoom: typeof deleteRoom = (base, shortCode, hostToken) =>
    deleteRoom(base, shortCode, hostToken, { fetch: this.recordingFetch });

  /** Text frames on one socket label in one direction, in order; JSON parsed, anything else as the raw string. */
  framesFor(label: string, direction: Direction): unknown[] {
    const frames: unknown[] = [];
    for (const entry of this.entries) {
      if (entry.kind !== 'ws-text' || entry.label !== label || entry.direction !== direction) continue;
      frames.push(parseJson(entry.text) ?? entry.text);
    }
    return frames;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function describeEntry(entry: CaptureEntry, index: number): string {
  if (entry.kind === 'http') return `entry #${index} http ${entry.method} ${entry.path}`;
  if (entry.kind === 'ws-close') return `entry #${index} ws-close ${entry.role}/${entry.label}`;
  return `entry #${index} ${entry.kind} ${entry.role}/${entry.label} ${entry.direction}`;
}

export interface Leak {
  readonly canary: string;
  readonly form: 'plain' | 'case-folded' | 'base64';
  readonly where: string;
}

/** The base64 fragments that appear whenever `canary` is base64-encoded at any byte alignment. */
function base64Fragments(canary: string): string[] {
  const fragments: string[] = [];
  for (const offset of [0, 1, 2]) {
    const encoded = Buffer.from('x'.repeat(offset) + canary).toString('base64');
    const fragment = encoded.slice(offset > 0 ? 4 : 0, -4);
    if (fragment.length >= 8) fragments.push(fragment);
  }
  return fragments;
}

/** Every place a canary appears in recorded text or HTTP bodies, plain, case-folded or base64-encoded. */
export function findLeaks(entries: readonly CaptureEntry[], canaries: readonly string[]): Leak[] {
  const leaks: Leak[] = [];
  const scan = (text: string, where: string) => {
    const lower = text.toLowerCase();
    for (const canary of canaries) {
      if (text.includes(canary)) leaks.push({ canary, form: 'plain', where });
      else if (lower.includes(canary.toLowerCase())) leaks.push({ canary, form: 'case-folded', where });
      else if (base64Fragments(canary).some((fragment) => text.includes(fragment))) leaks.push({ canary, form: 'base64', where });
    }
  };
  entries.forEach((entry, index) => {
    const where = describeEntry(entry, index);
    if (entry.kind === 'ws-text') scan(entry.text, where);
    if (entry.kind === 'http') {
      scan(entry.requestBody, `${where} request`);
      scan(entry.responseBody, `${where} response`);
    }
  });
  return leaks;
}

export interface FrameViolation {
  readonly where: string;
  readonly problem: string;
}

type Allowed = Readonly<Record<string, readonly string[]>>;

/** Allowed frame types and their top-level keys per role and direction (`packages/contracts/src/sharing.ts`). */
const ALLOWED: Readonly<Record<SocketRole, Readonly<Record<Direction, Allowed>>>> = {
  host: {
    'to-service': {
      admit: ['type', 'githubId', 'contributor'],
      kick: ['type', 'githubId'],
      revoke: ['type', 'githubId'],
      unrevoke: ['type', 'githubId'],
      'set-controller': ['type', 'githubId'],
      'set-contributor': ['type', 'githubId', 'contributor'],
      signal: ['type', 'githubId', 'data'],
      'ice-servers': ['type'],
      end: ['type'],
    },
    'from-service': {
      room: ['type', 'snapshot'],
      signal: ['type', 'githubId', 'data'],
      'ice-servers': ['type', 'iceServers'],
      error: ['type', 'code', 'githubId'],
    },
  },
  viewer: {
    'to-service': {
      signal: ['type', 'data'],
      'ice-servers': ['type'],
      leave: ['type'],
    },
    'from-service': {
      status: ['type', 'status', 'contributor'],
      signal: ['type', 'data'],
      'ice-servers': ['type', 'iceServers'],
      error: ['type', 'code'],
    },
  },
};

/** The hosted web viewer's keepalive texts (PAN-4481): the only non-JSON frames allowed. */
const KEEPALIVE: Readonly<Record<SocketRole, Readonly<Record<Direction, string | null>>>> = {
  host: { 'to-service': null, 'from-service': null },
  viewer: { 'to-service': 'ping', 'from-service': 'pong' },
};

const SIGNAL_DATA_KEYS = ['sdp', 'candidate'];
const SDP_KEYS = ['type', 'sdp'];
const CANDIDATE_KEYS = ['candidate', 'sdpMid', 'sdpMLineIndex'];
const SNAPSHOT_KEYS = ['shortCode', 'scope', 'dataOwner', 'controllerGithubId', 'hostConnected', 'participants', 'blocked'];
const SCOPE_KEYS = ['kind', 'conversationId'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Problems with `value`'s keys against `allowed`, naming each extra key; `path` names the field. */
function keyProblems(value: unknown, allowed: readonly string[], path: string): string[] {
  if (!isRecord(value)) return [`${path} is not an object`];
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path} has unknown key "${key}"`);
}

function signalProblems(frame: Record<string, unknown>): string[] {
  const data = frame['data'];
  const problems = keyProblems(data, SIGNAL_DATA_KEYS, 'signal data');
  if (!isRecord(data)) return problems;
  if (data['sdp'] !== undefined) {
    const sdp = data['sdp'];
    problems.push(...keyProblems(sdp, SDP_KEYS, 'signal data.sdp'));
    if (isRecord(sdp) && sdp['type'] !== 'offer' && sdp['type'] !== 'answer') problems.push('signal data.sdp.type is not offer or answer');
  }
  if (data['candidate'] !== undefined) problems.push(...keyProblems(data['candidate'], CANDIDATE_KEYS, 'signal data.candidate'));
  return problems;
}

function roomProblems(frame: Record<string, unknown>): string[] {
  const snapshot = frame['snapshot'];
  const problems = keyProblems(snapshot, SNAPSHOT_KEYS, 'room snapshot');
  if (isRecord(snapshot)) problems.push(...keyProblems(snapshot['scope'], SCOPE_KEYS, 'room snapshot.scope'));
  return problems;
}

/** Every frame that is binary, not JSON, of an undocumented type, or carries an undocumented key. */
export function frameViolations(entries: readonly CaptureEntry[]): FrameViolation[] {
  const violations: FrameViolation[] = [];
  entries.forEach((entry, index) => {
    const where = describeEntry(entry, index);
    if (entry.kind === 'ws-binary') {
      violations.push({ where, problem: 'binary frame' });
      return;
    }
    if (entry.kind !== 'ws-text') return;
    if (entry.text === KEEPALIVE[entry.role][entry.direction]) return;
    const frame = parseJson(entry.text);
    if (!isRecord(frame) || typeof frame['type'] !== 'string') {
      violations.push({ where, problem: 'not a JSON frame with a string type' });
      return;
    }
    const type = frame['type'];
    const allowed = Object.hasOwn(ALLOWED[entry.role][entry.direction], type) ? ALLOWED[entry.role][entry.direction][type] : undefined;
    if (!allowed) {
      violations.push({ where, problem: `type "${type}" is not allowed for ${entry.role} ${entry.direction}` });
      return;
    }
    const problems = keyProblems(frame, allowed, type);
    if (type === 'signal') problems.push(...signalProblems(frame));
    if (type === 'room') problems.push(...roomProblems(frame));
    for (const problem of problems) violations.push({ where, problem });
  });
  return violations;
}

export interface CaptureSummary {
  offers: number;
  answers: number;
  hostCandidates: number;
  viewerCandidates: number;
  roomSnapshots: number;
  posts: number;
  deletes: number;
}

/** Counts of the frames and requests that prove the capture sat on the live signaling path. */
export function summarize(entries: readonly CaptureEntry[]): CaptureSummary {
  const summary: CaptureSummary = { offers: 0, answers: 0, hostCandidates: 0, viewerCandidates: 0, roomSnapshots: 0, posts: 0, deletes: 0 };
  for (const entry of entries) {
    if (entry.kind === 'http') {
      if (entry.method === 'POST') summary.posts += 1;
      if (entry.method === 'DELETE') summary.deletes += 1;
      continue;
    }
    if (entry.kind !== 'ws-text') continue;
    const frame = parseJson(entry.text);
    if (!isRecord(frame)) continue;
    if (frame['type'] === 'room' && entry.direction === 'from-service') summary.roomSnapshots += 1;
    if (frame['type'] !== 'signal' || entry.direction !== 'to-service') continue;
    const data = isRecord(frame['data']) ? frame['data'] : {};
    const sdpType = isRecord(data['sdp']) ? data['sdp']['type'] : undefined;
    if (entry.role === 'host' && sdpType === 'offer') summary.offers += 1;
    if (entry.role === 'viewer' && sdpType === 'answer') summary.answers += 1;
    if (data['candidate'] !== undefined) {
      if (entry.role === 'host') summary.hostCandidates += 1;
      else summary.viewerCandidates += 1;
    }
  }
  return summary;
}
