/**
 * Session Vault wire format (PAN-2609): PRD "Record format", "Encryption (D-3)",
 * decisions P-3, P-5, P-7, P-19.
 *
 * Chunks
 *   plaintext  = JSON { v: 1, codec: "zstd", lineHashes, lines }   (lines are the raw
 *                native JSONL lines as strings, never re-serialized)
 *   chunk id   = hex(HMAC-SHA256(K_id, plaintext))[:40]  (keyed, so the backend cannot
 *                confirm a guess of a chunk's content; identical plaintext still dedupes)
 *   stored     = nonce(12) || AES-256-GCM(K_enc, zstd(plaintext), aad = chunk id) || tag(16)
 *
 * WIP parts (PAN-4329): a git bundle of the owner's uncommitted code, split into
 * slices of at most WIP_PART_BYTES
 *   part id    = hex(HMAC-SHA256(K_id, "overdeck-wip-part-v1\0" || bytes))[:40]
 *                (domain-separated, so a part id never equals a chunk id)
 *   stored     = the chunk envelope over zstd(bytes), aad = part id
 *
 * Refs (records, machines, header) use the same envelope with the ref name as
 * associated data, so a value cannot be moved between refs. Every decrypted ref
 * value carries `type`; readers return null for a type they do not know (P-19).
 *
 * Key ring (PAN-4333): a rotation re-seals every ref under the new key and
 * keeps the retired keys in the header's `keyRing`. Chunks and WIP parts keep
 * the key they were sealed under, so `decodeChunk` and `decodeWipParts` try the
 * current sub-keys and then each `keys.previous` entry. Encoding and ref
 * reads use only the current key.
 *
 * node:crypto and node:zlib only (NFR-9). Imports only Node built-ins and
 * sibling vault modules.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { lineHash, type Tail } from './continuity.js';
import type { CwdState } from './cwd-state.js';
import type { VaultSubkeys } from './identity.js';

// zstd landed in Node 22.15 (package.json requires >= 22.16); the installed
// @types/node predates it, so the two functions are typed here.
type ZstdCallback = (error: Error | null, result: Buffer) => void;
type ZstdFn = (input: Uint8Array, callback: ZstdCallback) => void;
const zlibWithZstd = zlib as unknown as { zstdCompress?: ZstdFn; zstdDecompress?: ZstdFn };
if (typeof zlibWithZstd.zstdCompress !== 'function' || typeof zlibWithZstd.zstdDecompress !== 'function') {
  throw new Error(`Session Vault needs zstd support in node:zlib (Node >= 22.15); running ${process.version}`);
}
const zstdCompressAsync = promisify(zlibWithZstd.zstdCompress);
const zstdDecompressAsync = promisify(zlibWithZstd.zstdDecompress);

export const FORMAT_VERSION = 1;
export const CHUNK_CODEC = 'zstd';
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const ID_HEX_LENGTH = 40;
export const HEADER_CHECK = 'overdeck-vault-key-check';
export const HEADER_REF_NAME = 'h/header';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkPlaintext {
  v: 1;
  codec: typeof CHUNK_CODEC;
  lineHashes: string[];
  lines: string[];
}

export interface EncodedChunk {
  id: string;
  bytes: Uint8Array;
  lineHashes: string[];
  /** Plaintext byte length before compression. */
  plaintextBytes: number;
}

export interface DecodedChunk {
  lines: string[];
  lineHashes: string[];
}

/** Which native file a saved conversation currently belongs to (P-5). */
export interface SegmentPrefix {
  viewFromChunk: number;
  viewFromLine: number;
  logEnd: number;
  sessionIdFrom: string;
  sessionIdTo: string;
  cwdFrom: string;
  cwdTo: string;
  lineCount: number;
}

export interface RecordSegment {
  environmentId: string;
  nativeSessionId: string;
  /** LOG line index where this owner's own lines begin. */
  logStart: number;
  /** null for the original owner; the materialized prefix for an adopter. */
  prefix: SegmentPrefix | null;
  tail: Tail;
}

/**
 * Written by PAN-4329 WIP capture (`wip-capture.ts`, anywhere-accounts design
 * 6.7): an encrypted snapshot of the owner's uncommitted code taken with this
 * settlement, or the reason one was skipped. A persisted skip carries the
 * (base, tree) pair and capture time it was computed for. Phase A never wrote
 * it; readers tolerate its absence and ignore fields they do not know.
 */
export type WipSnapshotRef =
  | {
      base: string;
      branch: string | null;
      tree: string;
      /** WIP part ids holding the encrypted bundle, in order. */
      objects: string[];
      bytes: number;
      at: string;
    }
  | {
      skipped: 'clean' | 'too-large' | 'secret' | 'no-git' | 'error';
      base?: string;
      tree?: string;
      at?: string;
      bytes?: number;
      reason?: string;
    };

export interface Settlement {
  at: string;
  /** Last chunk id written by this settlement. */
  chunk: string;
  /** Human turns in the whole transcript after this settlement (FR-18). */
  turn: number;
  /** Settleable lines in the owner's native file after this settlement; versions map onto it (P-7). */
  lines: number;
  /**
   * Cumulative LOG line count (every line in every chunk) after this
   * settlement. Eviction checks it against the owner's segment so a LOG that
   * was appended twice can never be marked verified. Absent only in records
   * written before this field existed; readers then count the chunks.
   */
  logLines?: number;
  cwdState: CwdState | null;
  /** WIP code snapshot or skip, written by PAN-4329 capture. Absent in every Phase A settlement. */
  wip?: WipSnapshotRef;
}

export interface SessionRecord {
  v: 1;
  type: 'session';
  vaultId: string;
  owner: { environmentId: string; label: string };
  harness: string;
  nativeSessionId: string;
  title: string;
  model: string | null;
  project: string | null;
  cwd: string;
  gitOrigin: string | null;
  /** Chunk ids in order (FR-10). */
  log: string[];
  /** VIEW start; runs to the end. */
  view: { fromChunk: number; fromLine: number };
  /** Set on version forks (P-7). */
  parent: { vaultId: string; version: number } | null;
  segments: RecordSegment[];
  /** The last 500 settlements; older ones are folded into `settlementsArchive` chunks. */
  settlements: Settlement[];
  settlementsArchive?: string[];
  lineage: Array<{ environmentId: string; adoptedAt: string }>;
  tombstone: false;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

/** What an excluded record becomes (P-11). */
export interface SessionTombstone {
  v: 1;
  type: 'session';
  vaultId: string;
  tombstone: true;
}

export type SessionRecordValue = SessionRecord | SessionTombstone;

export interface MachineRecord {
  v: 1;
  type: 'machine';
  environmentId: string;
  label: string;
  updatedAt: string;
}

export interface VaultHeader {
  v: 1;
  type: 'header';
  check: typeof HEADER_CHECK;
  createdAt: string;
  /** PAN-4333: when the key was last rotated. Absent before the first rotation. */
  rotatedAt?: string;
  /** PAN-4333: retired vault keys, base64 of 32 raw bytes each, newest first. */
  keyRing?: string[];
}

/** PAN-4333: written at a ref's old name when a rotation moved the ref; sealed under the retired key. */
export interface RetiredRefMarker {
  v: 1;
  type: 'retired';
  at: string;
}

export type RefKind = 'record' | 'machine' | 'header';

// ---------------------------------------------------------------------------
// Ids and names
// ---------------------------------------------------------------------------

function hmacHex40(key: Uint8Array, data: Uint8Array | string): string {
  return createHmac('sha256', key).update(data).digest('hex').slice(0, ID_HEX_LENGTH);
}

/** `r/<hmac(K_ref,'rec:'+vaultId)>`, `m/<hmac(K_ref,'env:'+environmentId)>`, or `h/header`. */
export function refName(kind: RefKind, id: string, K_ref: Uint8Array): string {
  switch (kind) {
    case 'record':
      return `r/${hmacHex40(K_ref, `rec:${id}`)}`;
    case 'machine':
      return `m/${hmacHex40(K_ref, `env:${id}`)}`;
    case 'header':
      return HEADER_REF_NAME;
  }
}

export function chunkIdFor(plaintext: Uint8Array, K_id: Uint8Array): string {
  return hmacHex40(K_id, plaintext);
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export class VaultAuthenticationError extends Error {
  override readonly name = 'VaultAuthenticationError';
}

function seal(K_enc: Uint8Array, aad: string, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', K_enc, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function unseal(K_enc: Uint8Array, aad: string, bytes: Uint8Array): Uint8Array {
  if (bytes.length < NONCE_BYTES + TAG_BYTES) {
    throw new VaultAuthenticationError('Encrypted value is too short to be a vault envelope');
  }
  const buffer = Buffer.from(bytes);
  const nonce = buffer.subarray(0, NONCE_BYTES);
  const tag = buffer.subarray(buffer.length - TAG_BYTES);
  const body = buffer.subarray(NONCE_BYTES, buffer.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', K_enc, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (error) {
    throw new VaultAuthenticationError(
      `Vault value failed authentication for ${JSON.stringify(aad)}: ${(error as Error).message}`,
    );
  }
}

async function sealJson(K_enc: Uint8Array, aad: string, value: unknown): Promise<Uint8Array> {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  return seal(K_enc, aad, await zstdCompressAsync(plaintext));
}

async function unsealJson(K_enc: Uint8Array, aad: string, bytes: Uint8Array): Promise<unknown> {
  const compressed = unseal(K_enc, aad, bytes);
  const plaintext = await zstdDecompressAsync(compressed);
  return JSON.parse(plaintext.toString('utf8'));
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

/** Encode one settlement's lines into an encrypted chunk. */
export async function encodeChunk(lines: readonly string[], keys: VaultSubkeys): Promise<EncodedChunk> {
  const lineHashes = lines.map((line) => lineHash(line));
  const plaintextValue: ChunkPlaintext = { v: 1, codec: CHUNK_CODEC, lineHashes, lines: [...lines] };
  const plaintext = Buffer.from(JSON.stringify(plaintextValue), 'utf8');
  const id = chunkIdFor(plaintext, keys.K_id);
  const compressed = await zstdCompressAsync(plaintext);
  return { id, bytes: seal(keys.K_enc, id, compressed), lineHashes, plaintextBytes: plaintext.length };
}

function isChunkPlaintext(value: unknown): value is ChunkPlaintext {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    record.codec === CHUNK_CODEC &&
    Array.isArray(record.lineHashes) &&
    Array.isArray(record.lines) &&
    record.lines.every((line) => typeof line === 'string') &&
    record.lineHashes.length === record.lines.length
  );
}

async function decodeChunkWith(bytes: Uint8Array, id: string, keys: VaultSubkeys): Promise<DecodedChunk> {
  const compressed = unseal(keys.K_enc, id, bytes);
  const plaintext = await zstdDecompressAsync(compressed);
  if (chunkIdFor(plaintext, keys.K_id) !== id) {
    throw new VaultAuthenticationError(`Chunk ${id} does not match its content id`);
  }
  const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
  if (!isChunkPlaintext(parsed)) throw new Error(`Chunk ${id} has an unexpected plaintext shape`);
  return { lines: parsed.lines, lineHashes: parsed.lineHashes };
}

/**
 * Run `decode` with the current sub-keys, then with each retired key's
 * (`keys.previous`, newest first). Throws the current key's
 * VaultAuthenticationError when none authenticates; any other error at once.
 */
async function withKeyRing<T>(keys: VaultSubkeys, decode: (candidate: VaultSubkeys) => Promise<T>): Promise<T> {
  let first: unknown;
  for (const candidate of [keys, ...(keys.previous ?? [])]) {
    try {
      return await decode(candidate);
    } catch (error) {
      if (!(error instanceof VaultAuthenticationError)) throw error;
      first ??= error;
    }
  }
  throw first;
}

/**
 * Decrypt and verify a chunk, falling back through the key ring. Any
 * authentication failure or id mismatch under every key rejects.
 */
export function decodeChunk(bytes: Uint8Array, id: string, keys: VaultSubkeys): Promise<DecodedChunk> {
  return withKeyRing(keys, (candidate) => decodeChunkWith(bytes, id, candidate));
}

/**
 * Split an append into chunks whose raw line bytes stay under `maxChunkBytes`
 * (NFR-6). A single line larger than the limit becomes a chunk of its own
 * rather than failing. Concatenating the result reproduces the input.
 */
export function splitIntoChunks(lines: readonly string[], maxChunkBytes: number): string[][] {
  if (maxChunkBytes <= 0) throw new Error(`maxChunkBytes must be positive, got ${maxChunkBytes}`);
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (current.length > 0 && currentBytes + size > maxChunkBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(line);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// WIP parts (PAN-4329)
// ---------------------------------------------------------------------------

export const WIP_PART_BYTES = 8 * 1024 * 1024;
const WIP_PART_DOMAIN = Buffer.from('overdeck-wip-part-v1\0', 'utf8');

export interface EncodedWipPart {
  id: string;
  bytes: Uint8Array;
}

export function wipPartIdFor(bytes: Uint8Array, K_id: Uint8Array): string {
  return hmacHex40(K_id, Buffer.concat([WIP_PART_DOMAIN, bytes]));
}

/** Split raw bundle bytes into ≤ WIP_PART_BYTES parts and seal each: zstd, then AES-256-GCM with aad = part id. */
export async function encodeWipParts(bundle: Uint8Array, keys: VaultSubkeys): Promise<EncodedWipPart[]> {
  if (bundle.length === 0) throw new Error('Cannot encode an empty WIP bundle');
  const parts: EncodedWipPart[] = [];
  for (let offset = 0; offset < bundle.length; offset += WIP_PART_BYTES) {
    const slice = bundle.subarray(offset, offset + WIP_PART_BYTES);
    const id = wipPartIdFor(slice, keys.K_id);
    parts.push({ id, bytes: seal(keys.K_enc, id, await zstdCompressAsync(slice)) });
  }
  return parts;
}

async function decodeWipPartWith(part: EncodedWipPart, keys: VaultSubkeys): Promise<Buffer> {
  const compressed = unseal(keys.K_enc, part.id, part.bytes);
  let slice: Buffer;
  try {
    slice = await zstdDecompressAsync(compressed);
  } catch (error) {
    throw new VaultAuthenticationError(`WIP part ${part.id} does not decompress: ${(error as Error).message}`);
  }
  if (wipPartIdFor(slice, keys.K_id) !== part.id) {
    throw new VaultAuthenticationError(`WIP part ${part.id} does not match its content id`);
  }
  return slice;
}

/**
 * Decrypt, decompress and id-check each part in order, each through the key
 * ring; concatenate. Any failure throws VaultAuthenticationError.
 */
export async function decodeWipParts(parts: ReadonlyArray<EncodedWipPart>, keys: VaultSubkeys): Promise<Buffer> {
  if (parts.length === 0) throw new VaultAuthenticationError('A WIP snapshot has no parts');
  const slices: Buffer[] = [];
  for (const part of parts) {
    slices.push(await withKeyRing(keys, (candidate) => decodeWipPartWith(part, candidate)));
  }
  return Buffer.concat(slices);
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

/** Encrypt a ref value (record, machine, header or retired marker) bound to its ref name. */
export function encryptRef(
  name: string,
  value: SessionRecordValue | MachineRecord | VaultHeader | RetiredRefMarker,
  keys: VaultSubkeys,
): Promise<Uint8Array> {
  return sealJson(keys.K_enc, name, value);
}

/** Decrypt a ref value bound to its ref name; the caller checks `type`. */
export function decryptRef(name: string, bytes: Uint8Array, keys: VaultSubkeys): Promise<unknown> {
  return unsealJson(keys.K_enc, name, bytes);
}

function hasType(value: unknown, type: string): value is { v: 1; type: string } {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type
    && (value as { v?: unknown }).v === 1;
}

/** A record ref value, or null when the decrypted value is not a session (P-19). */
export async function readSessionRecord(name: string, bytes: Uint8Array, keys: VaultSubkeys): Promise<SessionRecordValue | null> {
  const value = await decryptRef(name, bytes, keys);
  if (!hasType(value, 'session')) return null;
  const record = value as { vaultId?: unknown; tombstone?: unknown };
  if (typeof record.vaultId !== 'string') return null;
  return value as SessionRecordValue;
}

export async function readMachineRecord(name: string, bytes: Uint8Array, keys: VaultSubkeys): Promise<MachineRecord | null> {
  const value = await decryptRef(name, bytes, keys);
  return hasType(value, 'machine') ? (value as MachineRecord) : null;
}

export function newVaultHeader(now = new Date()): VaultHeader {
  return { v: 1, type: 'header', check: HEADER_CHECK, createdAt: now.toISOString() };
}

/** The header, or null when the value is not a header with the expected check string. */
export async function readVaultHeader(bytes: Uint8Array, keys: VaultSubkeys): Promise<VaultHeader | null> {
  const value = await decryptRef(HEADER_REF_NAME, bytes, keys);
  if (!hasType(value, 'header')) return null;
  return (value as VaultHeader).check === HEADER_CHECK ? (value as VaultHeader) : null;
}

const KEY_RING_ENTRY_BYTES = 32;

/** The header's retired keys, newest first; [] before the first rotation. Throws on a malformed ring. */
export function parseKeyRing(header: VaultHeader): Buffer[] {
  const ring: unknown = header.keyRing;
  if (ring === undefined) return [];
  if (!Array.isArray(ring)) throw new Error('Vault header key ring is malformed');
  return ring.map((entry: unknown) => {
    if (typeof entry !== 'string') throw new Error('Vault header key ring is malformed');
    const key = Buffer.from(entry, 'base64');
    if (key.length !== KEY_RING_ENTRY_BYTES || key.toString('base64') !== entry) {
      throw new Error('Vault header key ring is malformed');
    }
    return key;
  });
}

export function isTombstone(value: SessionRecordValue): value is SessionTombstone {
  return value.tombstone === true;
}
