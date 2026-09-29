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
 * Refs (records, machines, header) use the same envelope with the ref name as
 * associated data, so a value cannot be moved between refs. Every decrypted ref
 * value carries `type`; readers return null for a type they do not know (P-19).
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
 * Reserved for PAN-4329 (WIP code snapshots, anywhere-accounts design 6.7):
 * an encrypted snapshot of the owner's uncommitted code taken with this
 * settlement, or the reason one was skipped. Phase A never writes it; readers
 * tolerate its absence and ignore fields they do not know.
 */
export type WipSnapshotRef =
  | {
      base: string;
      branch: string | null;
      tree: string;
      /** Chunk ids holding the encrypted bundle. */
      objects: string[];
      bytes: number;
      at: string;
    }
  | { skipped: 'too-large' | 'secret' | 'no-git' | 'error'; bytes?: number; reason?: string };

export interface Settlement {
  at: string;
  /** Last chunk id written by this settlement. */
  chunk: string;
  /** Human turns in the whole transcript after this settlement (FR-18). */
  turn: number;
  /** Cumulative LOG line count after this settlement; versions map onto it (P-7). */
  lines: number;
  cwdState: CwdState | null;
  /** Reserved (PAN-4329). Absent in every Phase A settlement. */
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

/** Decrypt and verify a chunk. Any authentication failure or id mismatch rejects. */
export async function decodeChunk(bytes: Uint8Array, id: string, keys: VaultSubkeys): Promise<DecodedChunk> {
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
// Refs
// ---------------------------------------------------------------------------

/** Encrypt a ref value (record, machine or header) bound to its ref name. */
export function encryptRef(name: string, value: SessionRecordValue | MachineRecord | VaultHeader, keys: VaultSubkeys): Promise<Uint8Array> {
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

export function isTombstone(value: SessionRecordValue): value is SessionTombstone {
  return value.tombstone === true;
}
