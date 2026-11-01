/**
 * Decoding of machine → directory frames (PRD PAN-2356 WI-5, "Wire protocol").
 *
 * Input is untrusted. Binary frames, strings over 64 KiB, non-JSON, non-objects, unknown types
 * and wrong field types are all `bad_frame`. Each frame is rebuilt from its known keys only, so an
 * unlisted field is never stored or forwarded.
 */
import { CONNECT_PROTOCOL_VERSION } from '../../../packages/contracts/src/connect.ts';
import type { DirectoryEndpoint, MachineToDirectoryFrame } from '../../../packages/contracts/src/connect.ts';

/** 64 KiB, counted in UTF-16 code units (`string.length`). */
export const MAX_FRAME_CHARS = 65_536;
export const MAX_LABEL_CHARS = 64;
export const MAX_ENDPOINTS = 16;
export const MAX_ENDPOINT_URL_CHARS = 256;
export const MAX_VERSION_CHARS = 64;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
const ENDPOINT_URL_RE = /^(tcp|wss):\/\/[^\s]+$/;
/** C0 and C1 control characters, plus DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** `unsupported` is a well-formed `hello` for another protocol version (close 4010). */
export type DecodeResult = { ok: true; frame: MachineToDirectoryFrame } | { ok: false; reason: 'bad_frame' | 'unsupported' };

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

function build(obj: Obj): MachineToDirectoryFrame {
  const type = obj['type'];
  switch (type) {
    case 'hello': {
      const protocol = obj['protocol'];
      const linkProtocol = obj['linkProtocol'];
      if (typeof protocol !== 'number' || !Number.isSafeInteger(protocol)) fail();
      if (protocol !== CONNECT_PROTOCOL_VERSION) throw new Unsupported('unsupported');
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
    default:
      return fail();
  }
}

export function decodeMachineFrame(raw: string | ArrayBuffer): DecodeResult {
  const bad = { ok: false, reason: 'bad_frame' } as const;
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_CHARS) return bad;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return bad;
  }
  if (!isObject(parsed)) return bad;
  try {
    return { ok: true, frame: build(parsed) };
  } catch (error) {
    if (error instanceof Invalid) return bad;
    if (error instanceof Unsupported) return { ok: false, reason: 'unsupported' };
    throw error;
  }
}
