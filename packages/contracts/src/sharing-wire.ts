// Shared Sessions content wire format runtime (PAN-4474, slice 3): the helpers both ends of a share's
// WebRTC data channels use — the allow-list mapping from ChatMessage, envelope decoding, fragmenting
// and reassembly, per-channel per-stream `seq` gap detection, and hello negotiation. The types are in
// sharing.ts; this file is separate because the share Worker imports sharing.ts by relative path and
// must never pull runtime code. The host dashboard server (slice 3) and the viewer browser (slice 4)
// both use these helpers. PAN-4476 (slice 5) adds the shared-prompt rule, the draft payload reader
// and a smaller reassembly cap for what a host reads from a viewer.

import type { ChatMessage } from "./rpc"
import type {
  DraftPayload,
  SharedChannel,
  SharedEnvelope,
  SharedHello,
  SharedHelloError,
  SharedMessage,
  ShareScope,
} from "./sharing"

export const SHARED_WIRE_VERSION = 1
export const SHARED_SCOPE_KINDS: readonly ShareScope["kind"][] = ["conversation"]
export const SHARED_CHANNELS: readonly SharedChannel[] = ["control", "conversation", "drafts", "terminal", "presence"]
/** The longest data-channel message: 32,768 UTF-16 code units, at most 96 KiB of UTF-8. Longer envelopes are fragmented. */
export const SHARE_MAX_MESSAGE_CHARS = 32_768
/** The longest encoded envelope ever sent or reassembled. */
export const SHARE_MAX_ENVELOPE_CHARS = 32 * 1024 * 1024
/** The longest envelope a host reassembles from a viewer on `control` or `drafts` (NFR-3). */
export const SHARE_MAX_INBOUND_ENVELOPE_CHARS = 65_536
/** The longest shared prompt or draft, in UTF-16 code units (D-11). */
export const SHARED_PROMPT_MAX_CHARS = 8_000

/**
 * The longest single message a fragment can be: JSON escaping can turn each of a slice's
 * SHARE_MAX_MESSAGE_CHARS code units into six (`\u0000`), plus the chunk header.
 */
const MAX_FRAGMENT_MESSAGE_CHARS = SHARE_MAX_MESSAGE_CHARS * 6 + 256

export type SharedReadResult =
  | { readonly kind: "envelope"; readonly envelope: SharedEnvelope }
  | { readonly kind: "pending" }
  | { readonly kind: "invalid"; readonly reason: "not_json" | "not_envelope" | "chunk_out_of_order" | "too_large" }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** Copies only the allow-listed fields. Never spreads the input and never sets `author`. */
export function toSharedMessage(message: ChatMessage): SharedMessage {
  const shared: {
    id: string
    role: SharedMessage["role"]
    text: string
    turnId?: string
    createdAt: string
    completedAt?: string
    streaming?: boolean
    sequence?: number
  } = { id: message.id, role: message.role, text: message.text, createdAt: message.createdAt }
  if (typeof message.turnId === "string") shared.turnId = message.turnId
  if (typeof message.completedAt === "string") shared.completedAt = message.completedAt
  if (typeof message.streaming === "boolean") shared.streaming = message.streaming
  if (typeof message.sequence === "number" && Number.isFinite(message.sequence)) shared.sequence = message.sequence
  return shared
}

/**
 * `null` when a shared prompt may be delivered; the refusal reason otherwise (D-9). A leading `/`, `!`
 * or `#` would reach a composer command, a shell command or a memory note, so it is refused.
 */
export function sharedPromptRefusal(text: string): "invalid_prompt" | "too_long" | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return "invalid_prompt"
  if (text.length > SHARED_PROMPT_MAX_CHARS) return "too_long"
  const first = trimmed[0]
  return first === "/" || first === "!" || first === "#" ? "invalid_prompt" : null
}

/** A host → viewer DraftPayload rebuilt from its known keys, or `null` when `value` is not one. */
export function readDraftPayload(value: unknown): DraftPayload | null {
  if (!isRecord(value)) return null
  const { authorGithubId, authorLogin, text, updatedAt } = value
  if (!isPositiveInteger(authorGithubId)) return null
  if (typeof authorLogin !== "string") return null
  if (typeof text !== "string" || text.length > SHARED_PROMPT_MAX_CHARS) return null
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null
  return { authorGithubId, authorLogin, text, updatedAt }
}

/** A new envelope with exactly the six envelope keys, or `null` when `value` is not one. */
export function decodeEnvelope(value: unknown): SharedEnvelope | null {
  if (!isRecord(value)) return null
  const { v, ch, streamId, seq, t } = value
  if (!isPositiveInteger(v)) return null
  if (typeof ch !== "string" || !(SHARED_CHANNELS as readonly string[]).includes(ch)) return null
  if (typeof streamId !== "string" || streamId.length === 0) return null
  if (!isPositiveInteger(seq)) return null
  if (typeof t !== "number" || !Number.isFinite(t)) return null
  if (!Object.prototype.hasOwnProperty.call(value, "payload")) return null
  return { v, ch: ch as SharedChannel, streamId, seq, t, payload: value.payload }
}

/**
 * Encodes one envelope as the data-channel messages to send in order: one message, or `count`
 * fragments when the encoded envelope is longer than SHARE_MAX_MESSAGE_CHARS. Slicing can split a
 * UTF-16 surrogate pair across fragments; the reader joins the slices before parsing, so the pair is
 * whole again. Throws RangeError when the encoded envelope is longer than SHARE_MAX_ENVELOPE_CHARS.
 */
export function encodeSharedMessage(envelope: SharedEnvelope, chunkId: number): string[] {
  const text = JSON.stringify(envelope)
  if (text.length > SHARE_MAX_ENVELOPE_CHARS) throw new RangeError("shared envelope too large")
  if (text.length <= SHARE_MAX_MESSAGE_CHARS) return [text]
  const count = Math.ceil(text.length / SHARE_MAX_MESSAGE_CHARS)
  const parts: string[] = []
  for (let index = 0; index < count; index++) {
    const data = text.slice(index * SHARE_MAX_MESSAGE_CHARS, (index + 1) * SHARE_MAX_MESSAGE_CHARS)
    parts.push(JSON.stringify({ v: SHARED_WIRE_VERSION, chunk: { id: chunkId, index, count }, data }))
  }
  return parts
}

interface PartialEnvelope {
  readonly id: number
  readonly count: number
  readonly parts: string[]
}

/**
 * Reads one channel's messages in arrival order and reassembles fragmented envelopes. One reader per
 * channel. `maxEnvelopeChars` caps what one envelope may grow to; a host reading a viewer passes
 * SHARE_MAX_INBOUND_ENVELOPE_CHARS so one viewer cannot make it buffer megabytes.
 */
export class SharedChannelReader {
  private partial: PartialEnvelope | null = null

  constructor(private readonly maxEnvelopeChars: number = SHARE_MAX_ENVELOPE_CHARS) {}

  read(text: string): SharedReadResult {
    // Refuse before parsing anything longer than either a capped envelope or a fragment can be, so an
    // oversized message is never parsed; the exact cap for an unfragmented envelope is checked below.
    if (text.length > Math.max(this.maxEnvelopeChars, MAX_FRAGMENT_MESSAGE_CHARS)) {
      return { kind: "invalid", reason: "too_large" }
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { kind: "invalid", reason: "not_json" }
    }
    if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "chunk")) return this.readFragment(value)
    if (text.length > this.maxEnvelopeChars) return { kind: "invalid", reason: "too_large" }
    return decoded(value)
  }

  private readFragment(value: Record<string, unknown>): SharedReadResult {
    const { chunk, data } = value
    if (!isRecord(chunk) || typeof data !== "string") return { kind: "invalid", reason: "not_envelope" }
    const { id, index, count } = chunk
    if (typeof id !== "number" || !Number.isFinite(id) || !isNonNegativeInteger(index) || !isNonNegativeInteger(count) || index >= count) {
      return { kind: "invalid", reason: "not_envelope" }
    }
    if (count * SHARE_MAX_MESSAGE_CHARS > this.maxEnvelopeChars + SHARE_MAX_MESSAGE_CHARS || data.length > SHARE_MAX_MESSAGE_CHARS) {
      this.partial = null
      return { kind: "invalid", reason: "too_large" }
    }
    const partial = this.partial
    if (partial === null) {
      if (index !== 0) return { kind: "invalid", reason: "chunk_out_of_order" }
      this.partial = { id, count, parts: [data] }
    } else {
      if (id !== partial.id || count !== partial.count || index !== partial.parts.length) {
        this.partial = null
        return { kind: "invalid", reason: "chunk_out_of_order" }
      }
      partial.parts.push(data)
    }
    const current = this.partial
    if (current === null || current.parts.length < current.count) return { kind: "pending" }
    this.partial = null
    const text = current.parts.join("")
    if (text.length > this.maxEnvelopeChars) return { kind: "invalid", reason: "too_large" }
    let joined: unknown
    try {
      joined = JSON.parse(text)
    } catch {
      return { kind: "invalid", reason: "not_json" }
    }
    return decoded(joined)
  }
}

function decoded(value: unknown): SharedReadResult {
  const envelope = decodeEnvelope(value)
  return envelope === null ? { kind: "invalid", reason: "not_envelope" } : { kind: "envelope", envelope }
}

/** Detects `seq` gaps per channel and stream. A gap is reported once; tracking resumes after it. */
export class SeqTracker {
  private readonly expected = new Map<string, number>()

  observe(
    ch: SharedChannel,
    streamId: string,
    seq: number,
  ): { readonly ok: true } | { readonly ok: false; readonly expected: number; readonly got: number } {
    const key = `${ch}\n${streamId}`
    const expected = this.expected.get(key) ?? 1
    this.expected.set(key, seq + 1)
    return seq === expected ? { ok: true } : { ok: false, expected, got: seq }
  }
}

/** Agrees on `min(local.v, remote.v)` when the remote hello is well formed and both sides support the shared scope. */
export function negotiateHello(
  local: SharedHello,
  remote: unknown,
): { readonly ok: true; readonly v: number } | { readonly ok: false; readonly code: SharedHelloError } {
  if (!isRecord(remote)) return { ok: false, code: "invalid_hello" }
  const { v, scopeKinds, scope } = remote
  if (!isPositiveInteger(v)) return { ok: false, code: "invalid_hello" }
  if (!Array.isArray(scopeKinds) || !scopeKinds.every((kind) => typeof kind === "string")) {
    return { ok: false, code: "invalid_hello" }
  }
  if (!isRecord(scope) || typeof scope.kind !== "string" || typeof scope.conversationId !== "string") {
    return { ok: false, code: "invalid_hello" }
  }
  const agreed = Math.min(local.v, v)
  if (agreed < 1) return { ok: false, code: "version_unsupported" }
  if (!(scopeKinds as string[]).includes(local.scope.kind) || !(local.scopeKinds as readonly string[]).includes(scope.kind)) {
    return { ok: false, code: "scope_kind_unsupported" }
  }
  if (scope.kind !== local.scope.kind || scope.conversationId !== local.scope.conversationId) {
    return { ok: false, code: "invalid_hello" }
  }
  return { ok: true, v: agreed }
}
