/**
 * Frame decoding for the host and viewer WebSockets (PRD PAN-658 "Frame decoding").
 *
 * Input is untrusted. Binary frames and anything that is not a JSON object of a known `type` are
 * `invalid_frame`; strings over 64 KiB are `frame_too_large`. Each decoder builds a NEW object from
 * the frame's known keys only, so an unlisted field is never stored or forwarded.
 */
import type { HostFrame, SignalData, ViewerFrame } from '../../../packages/contracts/src/sharing.ts';

/** 64 KiB, counted in UTF-16 code units (`string.length`). */
export const MAX_FRAME_CHARS = 65_536;
export const MAX_SDP_CHARS = 32_768;
export const MAX_CANDIDATE_CHARS = 2_048;

export type DecodeError = 'invalid_frame' | 'frame_too_large';
export type DecodeResult<F> = { ok: true; frame: F } | { ok: false; code: DecodeError };

type Obj = Record<string, unknown>;

/** Thrown inside a decoder to reject the frame; caught at the top as `invalid_frame`. */
class Invalid extends Error {}

function fail(): never {
  throw new Invalid('invalid_frame');
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function githubIdOf(obj: Obj): number {
  const value = obj['githubId'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail();
  return value;
}

function requiredBoolean(obj: Obj, key: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') fail();
  return value;
}

function optionalBoolean(obj: Obj, key: string): boolean | undefined {
  if (!(key in obj)) return undefined;
  return requiredBoolean(obj, key);
}

function decodeSignalData(value: unknown): SignalData {
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

function decode<F>(raw: string | ArrayBuffer, build: (obj: Obj, type: unknown) => F): DecodeResult<F> {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid_frame' };
  if (raw.length > MAX_FRAME_CHARS) return { ok: false, code: 'frame_too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_frame' };
  }
  if (!isObject(parsed)) return { ok: false, code: 'invalid_frame' };
  try {
    return { ok: true, frame: build(parsed, parsed['type']) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, code: 'invalid_frame' };
    throw error;
  }
}

function buildHostFrame(obj: Obj, type: unknown): HostFrame {
  switch (type) {
    case 'admit': {
      const githubId = githubIdOf(obj);
      const contributor = optionalBoolean(obj, 'contributor');
      return contributor === undefined ? { type, githubId } : { type, githubId, contributor };
    }
    case 'kick':
    case 'revoke':
    case 'unrevoke':
    case 'set-controller':
      return { type, githubId: githubIdOf(obj) };
    case 'set-contributor':
      return { type, githubId: githubIdOf(obj), contributor: requiredBoolean(obj, 'contributor') };
    case 'signal':
      return { type, githubId: githubIdOf(obj), data: decodeSignalData(obj['data']) };
    case 'ice-servers':
    case 'end':
      return { type };
    default:
      return fail();
  }
}

function buildViewerFrame(obj: Obj, type: unknown): ViewerFrame {
  switch (type) {
    case 'signal':
      return { type, data: decodeSignalData(obj['data']) };
    case 'ice-servers':
    case 'leave':
      return { type };
    default:
      return fail();
  }
}

export function decodeHostFrame(raw: string | ArrayBuffer): DecodeResult<HostFrame> {
  return decode(raw, buildHostFrame);
}

export function decodeViewerFrame(raw: string | ArrayBuffer): DecodeResult<ViewerFrame> {
  return decode(raw, buildViewerFrame);
}
