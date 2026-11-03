/**
 * Decoding of machine and client (PAN-4829) → directory frames (PRD PAN-2356 WI-5, "Wire protocol").
 * A socket's role decides which frames it may send; `decodeFrame` takes that role.
 *
 * Input is untrusted. Binary frames, strings over 64 KiB, non-JSON, non-objects, unknown types
 * and wrong field types are all `bad_frame`. Each frame is rebuilt from its known keys only, so an
 * unlisted field is never stored or forwarded.
 */
import { ACTIVITY_COUNT_MAX, CONNECT_PROTOCOL_VERSION, PUSH_SEALED_MAX_CHARS } from '../../../packages/contracts/src/connect.ts';
import type { ClientToDirectoryFrame, DirectoryEndpoint, MachineToDirectoryFrame } from '../../../packages/contracts/src/connect.ts';
import type { SignalData } from '../../../packages/contracts/src/sharing.ts';

/** 64 KiB, counted in UTF-16 code units (`string.length`). */
export const MAX_FRAME_CHARS = 65_536;
export const MAX_LABEL_CHARS = 64;
export const MAX_ENDPOINTS = 16;
export const MAX_ENDPOINT_URL_CHARS = 256;
export const MAX_VERSION_CHARS = 64;
export const MAX_SDP_CHARS = 32_768;
export const MAX_CANDIDATE_CHARS = 2_048;
/** One `relay-usage` report covers at most 1e9 bytes. */
export const MAX_RELAY_USAGE_BYTES = 1_000_000_000;
/** An APNs or FCM device token in `push-register` (PAN-4830 D-6). */
export const MAX_PUSH_TOKEN_CHARS = 4_096;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
/** Session ids and approval request ids: 16 random bytes as 32 lowercase hex. */
export const ID_HEX_RE = /^[0-9a-f]{32}$/;
/** A machine-chosen correlation id for `ice-servers` and `inbox-create`. */
const REQUEST_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;
const INBOX_ID_RE = /^ib_[0-9a-f]{16}$/;
/** Inbox event ids are `crypto.randomUUID()` values. */
const EVENT_ID_RE = UUID_RE;
const ENDPOINT_URL_RE = /^(tcp|wss):\/\/[^\s]+$/;
/**
 * An APNs or FCM device token (PAN-4830 D-6). The token goes into the APNs URL path, so `/`, `?`,
 * `%` and spaces are refused.
 */
const PUSH_TOKEN_RE = /^[0-9A-Za-z:_.-]+$/;
/** Standard base64 with optional padding; a push's `sealed` blob (PAN-4830 D-6). */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** C0 and C1 control characters, plus DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** `unsupported` is a well-formed `hello` for another protocol version (close 4010). */
export type DecodeResult = { ok: true; frame: MachineToDirectoryFrame } | { ok: false; reason: 'bad_frame' | 'unsupported' };

/** A socket's role, fixed by its first valid hello (PAN-4829 D-1). */
export type SocketRole = 'machine' | 'client';

export type FrameDecodeResult =
  | { ok: true; role: 'machine'; frame: MachineToDirectoryFrame }
  | { ok: true; role: 'client'; frame: ClientToDirectoryFrame }
  | { ok: false; reason: 'bad_frame' | 'unsupported' };

type Obj = Record<string, unknown>;

/** Thrown inside a builder to reject the frame; caught at the top as `bad_frame`. */
class Invalid extends Error {}
class Unsupported extends Error {}

function fail(): never {
  throw new Invalid('bad_frame');
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(obj: Obj, key: string, max: number, re?: RegExp): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail();
  if (CONTROL_CHARS.test(value)) fail();
  if (re && !re.test(value)) fail();
  return value;
}

export function environmentIdOf(obj: Obj, key = 'environmentId'): string {
  return str(obj, key, 36, UUID_RE);
}

function endpointsOf(obj: Obj): DirectoryEndpoint[] {
  const value = obj['endpoints'];
  if (!Array.isArray(value) || value.length > MAX_ENDPOINTS) fail();
  return value.map((entry): DirectoryEndpoint => {
    if (!isObject(entry)) fail();
    const kind = entry['kind'];
    if (kind !== 'lan' && kind !== 'tailnet') fail();
    return { kind, url: str(entry, 'url', MAX_ENDPOINT_URL_CHARS, ENDPOINT_URL_RE) };
  });
}

/** A Live Activity count (PAN-4839): a safe integer in 0..ACTIVITY_COUNT_MAX. */
function countOf(obj: Obj, key: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > ACTIVITY_COUNT_MAX) fail();
  return value;
}

function bool(obj: Obj, key: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') fail();
  return value;
}

/** Share's SignalData rules (services/share/src/protocol.ts): sdp or candidate, capped lengths. */
function signalDataOf(value: unknown): SignalData {
  if (!isObject(value)) fail();
  let sdp: SignalData['sdp'];
  let candidate: SignalData['candidate'];
  if ('sdp' in value) {
    const raw = value['sdp'];
    if (!isObject(raw)) fail();
    const type = raw['type'];
    const text = raw['sdp'];
    if (type !== 'offer' && type !== 'answer') fail();
    if (typeof text !== 'string' || text.length > MAX_SDP_CHARS) fail();
    sdp = { type, sdp: text };
  }
  if ('candidate' in value) {
    const raw = value['candidate'];
    if (!isObject(raw)) fail();
    const text = raw['candidate'];
    if (typeof text !== 'string' || text.length > MAX_CANDIDATE_CHARS) fail();
    const out: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } = { candidate: text };
    if ('sdpMid' in raw) {
      const mid = raw['sdpMid'];
      if (mid !== null && typeof mid !== 'string') fail();
      out.sdpMid = mid;
    }
    if ('sdpMLineIndex' in raw) {
      const index = raw['sdpMLineIndex'];
      if (index !== null && (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)) fail();
      out.sdpMLineIndex = index;
    }
    candidate = out;
  }
  if (sdp === undefined && candidate === undefined) fail();
  return {
    ...(sdp !== undefined ? { sdp } : {}),
    ...(candidate !== undefined ? { candidate } : {}),
  };
}

/** A hello's `protocol`: a safe integer, and the version this service speaks. */
function protocolOf(obj: Obj): typeof CONNECT_PROTOCOL_VERSION {
  const protocol = obj['protocol'];
  if (typeof protocol !== 'number' || !Number.isSafeInteger(protocol)) fail();
  if (protocol !== CONNECT_PROTOCOL_VERSION) throw new Unsupported('unsupported');
  return protocol;
}

/** `ice-servers`, shared by machines and clients. */
function iceServersOf(obj: Obj): Extract<MachineToDirectoryFrame, { type: 'ice-servers' }> {
  return { type: 'ice-servers', requestId: str(obj, 'requestId', 64, REQUEST_ID_RE), relay: bool(obj, 'relay') };
}

/** `relay-usage`, shared by machines and clients. */
function relayUsageOf(obj: Obj): Extract<MachineToDirectoryFrame, { type: 'relay-usage' }> {
  const bytes = obj['bytes'];
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RELAY_USAGE_BYTES) fail();
  return { type: 'relay-usage', bytes };
}

function build(obj: Obj): MachineToDirectoryFrame {
  const type = obj['type'];
  switch (type) {
    case 'hello': {
      const protocol = protocolOf(obj);
      const linkProtocol = obj['linkProtocol'];
      if (typeof linkProtocol !== 'number' || !Number.isSafeInteger(linkProtocol)) fail();
      return {
        type,
        protocol,
        environmentId: environmentIdOf(obj),
        label: str(obj, 'label', MAX_LABEL_CHARS),
        publicKeyHex: str(obj, 'publicKeyHex', 64, KEY_HEX_RE),
        serverVersion: str(obj, 'serverVersion', MAX_VERSION_CHARS),
        linkProtocol,
        endpoints: endpointsOf(obj),
      };
    }
    case 'endpoints':
      return { type, endpoints: endpointsOf(obj) };
    case 'forget':
      return { type, environmentId: environmentIdOf(obj) };
    case 'signal': {
      const purpose = obj['purpose'];
      if (purpose !== 'link' && purpose !== 'approval') fail();
      return {
        type,
        to: environmentIdOf(obj, 'to'),
        session: str(obj, 'session', 32, ID_HEX_RE),
        purpose,
        relay: bool(obj, 'relay'),
        data: signalDataOf(obj['data']),
      };
    }
    case 'ice-servers':
      return iceServersOf(obj);
    case 'approval-request': {
      const to = obj['to'];
      return { type, requestId: str(obj, 'requestId', 32, ID_HEX_RE), to: to === null ? null : environmentIdOf(obj, 'to') };
    }
    case 'approval-cancel':
      return { type, requestId: str(obj, 'requestId', 32, ID_HEX_RE) };
    case 'inbox-create':
      return { type, requestId: str(obj, 'requestId', 64, REQUEST_ID_RE) };
    case 'inbox-delete':
      return { type, inboxId: str(obj, 'inboxId', 19, INBOX_ID_RE) };
    case 'inbox-ack':
      return { type, eventId: str(obj, 'eventId', 36, EVENT_ID_RE) };
    case 'inbox-nack': {
      const retryAfterSeconds = obj['retryAfterSeconds'];
      if (typeof retryAfterSeconds !== 'number' || !Number.isSafeInteger(retryAfterSeconds)) fail();
      if (retryAfterSeconds < 60 || retryAfterSeconds > 3600) fail();
      return { type, eventId: str(obj, 'eventId', 36, EVENT_ID_RE), retryAfterSeconds };
    }
    case 'relay-usage':
      return relayUsageOf(obj);
    case 'push': {
      const sealed = str(obj, 'sealed', PUSH_SEALED_MAX_CHARS, BASE64_RE);
      if (sealed.length < 4 || sealed.length % 4 !== 0) fail();
      const urgency = obj['urgency'];
      if (urgency !== 'high' && urgency !== 'normal') fail();
      return {
        type,
        requestId: str(obj, 'requestId', 32, ID_HEX_RE),
        to: environmentIdOf(obj, 'to'),
        sealed,
        urgency,
        collapseId: str(obj, 'collapseId', 32, ID_HEX_RE),
      };
    }
    case 'push-activity':
      return { type, to: environmentIdOf(obj, 'to'), needsYou: countOf(obj, 'needsYou'), running: countOf(obj, 'running') };
    default:
      return fail();
  }
}

/** Client frames (PAN-4829 D-4, PAN-4830); every machine-only type is `bad_frame`. */
function buildClient(obj: Obj): ClientToDirectoryFrame {
  const type = obj['type'];
  switch (type) {
    case 'hello-client': {
      const protocol = protocolOf(obj);
      const platform = obj['platform'];
      const frame = {
        type,
        protocol,
        clientId: str(obj, 'clientId', 36, UUID_RE),
        label: str(obj, 'label', MAX_LABEL_CHARS),
        publicKeyHex: str(obj, 'publicKeyHex', 64, KEY_HEX_RE),
        appVersion: str(obj, 'appVersion', 32),
      } as const;
      if (platform !== 'ios' && platform !== 'android') fail();
      return { ...frame, platform };
    }
    case 'signal': {
      if (obj['purpose'] !== 'link') fail();
      return {
        type,
        to: environmentIdOf(obj, 'to'),
        session: str(obj, 'session', 32, ID_HEX_RE),
        purpose: 'link',
        relay: bool(obj, 'relay'),
        data: signalDataOf(obj['data']),
      };
    }
    case 'ice-servers':
      return iceServersOf(obj);
    case 'relay-usage':
      return relayUsageOf(obj);
    case 'forget-client':
      return { type };
    case 'push-register': {
      const platform = obj['platform'];
      if (platform !== 'ios' && platform !== 'android') fail();
      const token = str(obj, 'token', MAX_PUSH_TOKEN_CHARS, PUSH_TOKEN_RE);
      const apsEnvironment = obj['apsEnvironment'];
      if (apsEnvironment === undefined) return { type, platform, token };
      if (platform !== 'ios' || (apsEnvironment !== 'production' && apsEnvironment !== 'sandbox')) fail();
      return { type, platform, token, apsEnvironment };
    }
    case 'push-unregister':
      return { type };
    case 'activity-register': {
      const token = str(obj, 'token', MAX_PUSH_TOKEN_CHARS, PUSH_TOKEN_RE);
      const apsEnvironment = obj['apsEnvironment'];
      if (apsEnvironment === undefined) return { type, token };
      if (apsEnvironment !== 'production' && apsEnvironment !== 'sandbox') fail();
      return { type, token, apsEnvironment };
    }
    case 'activity-unregister':
      return { type };
    default:
      return fail();
  }
}

/** Size, JSON and object checks shared by every role; `null` means `bad_frame`. */
function parse(raw: string | ArrayBuffer): Obj | null {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed : null;
}

/** Runs a builder, mapping its throws to a decode failure. */
function attempt<T>(builder: () => T): { ok: true; frame: T } | { ok: false; reason: 'bad_frame' | 'unsupported' } {
  try {
    return { ok: true, frame: builder() };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: 'bad_frame' };
    if (error instanceof Unsupported) return { ok: false, reason: 'unsupported' };
    throw error;
  }
}

/**
 * Decodes a frame by the socket's role (PAN-4829 D-4). With no role yet, `hello-client` is read
 * with the client rules and every other frame with the machine rules, so `hello` registers a
 * machine and any other first frame keeps today's `hello required` close.
 */
export function decodeFrame(raw: string | ArrayBuffer, role: SocketRole | null): FrameDecodeResult {
  const obj = parse(raw);
  if (obj === null) return { ok: false, reason: 'bad_frame' };
  const asClient = role === 'client' || (role === null && obj['type'] === 'hello-client');
  if (asClient) {
    const result = attempt(() => buildClient(obj));
    return result.ok ? { ok: true, role: 'client', frame: result.frame } : result;
  }
  const result = attempt(() => build(obj));
  return result.ok ? { ok: true, role: 'machine', frame: result.frame } : result;
}

export function decodeMachineFrame(raw: string | ArrayBuffer): DecodeResult {
  const obj = parse(raw);
  if (obj === null) return { ok: false, reason: 'bad_frame' };
  return attempt(() => build(obj));
}
