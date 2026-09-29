import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { lineHash } from '../../../../src/lib/vault/continuity.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import {
  HEADER_REF_NAME,
  NONCE_BYTES,
  TAG_BYTES,
  VaultAuthenticationError,
  chunkIdFor,
  decodeChunk,
  decryptRef,
  encodeChunk,
  encryptRef,
  isTombstone,
  newVaultHeader,
  readMachineRecord,
  readSessionRecord,
  readVaultHeader,
  refName,
  splitIntoChunks,
  type SessionRecord,
} from '../../../../src/lib/vault/format.js';

const keys = deriveSubkeys(createVaultKey());

function arbitraryLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify({ i, text: `héllo → 世界 \u0000 ${randomBytes(24).toString('base64')}` }),
  );
}

function sampleRecord(): SessionRecord {
  return {
    v: 1,
    type: 'session',
    vaultId: 'v-1',
    owner: { environmentId: 'env-a', label: 'desktop' },
    harness: 'claude-code',
    nativeSessionId: 'sess-1',
    title: 'Fix the parser',
    model: 'claude-fable-5-1',
    project: 'overdeck',
    cwd: '/home/u/overdeck',
    gitOrigin: 'git@github.com:eltmon/overdeck.git',
    log: ['a'.repeat(40)],
    view: { fromChunk: 0, fromLine: 0 },
    parent: null,
    segments: [{ environmentId: 'env-a', nativeSessionId: 'sess-1', logStart: 0, prefix: null, tail: { lineCount: 3, byteOffset: 300, lastHashes: ['x'] } }],
    settlements: [{ at: '2026-09-28T00:00:00.000Z', chunk: 'a'.repeat(40), turn: 2, cwdState: null }],
    lineage: [],
    tombstone: false,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    endedAt: null,
  };
}

describe('vault format: chunks', () => {
  it('ac1: encode then decode is byte-identical, with per-line hashes', async () => {
    const lines = arbitraryLines(50);
    const chunk = await encodeChunk(lines, keys);
    expect(chunk.id).toMatch(/^[0-9a-f]{40}$/);
    expect(chunk.lineHashes).toEqual(lines.map((line) => lineHash(line)));
    expect(chunk.bytes.length).toBeGreaterThan(NONCE_BYTES + TAG_BYTES);
    const decoded = await decodeChunk(chunk.bytes, chunk.id, keys);
    expect(decoded.lines).toEqual(lines);
    expect(Buffer.from(decoded.lines.join('\n')).equals(Buffer.from(lines.join('\n')))).toBe(true);
    expect(decoded.lineHashes).toEqual(chunk.lineHashes);
  });

  it('the chunk id is a keyed HMAC of the plaintext: same lines dedupe, other key differs', async () => {
    const lines = arbitraryLines(3);
    const a = await encodeChunk(lines, keys);
    const b = await encodeChunk(lines, keys);
    expect(a.id).toBe(b.id);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(false); // fresh nonce
    const otherKeys = deriveSubkeys(createVaultKey());
    expect((await encodeChunk(lines, otherKeys)).id).not.toBe(a.id);
    expect(chunkIdFor(Buffer.from('x'), keys.K_id)).not.toBe(chunkIdFor(Buffer.from('y'), keys.K_id));
  });

  it('ac2: a flipped byte anywhere is rejected as an authentication failure', async () => {
    const chunk = await encodeChunk(arbitraryLines(5), keys);
    for (const offset of [0, NONCE_BYTES, Math.floor(chunk.bytes.length / 2), chunk.bytes.length - 1]) {
      const tampered = Buffer.from(chunk.bytes);
      tampered[offset]! ^= 0x01;
      await expect(decodeChunk(tampered, chunk.id, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
    }
    await expect(decodeChunk(chunk.bytes, chunk.id, deriveSubkeys(createVaultKey()))).rejects.toBeInstanceOf(VaultAuthenticationError);
    await expect(decodeChunk(Buffer.alloc(5), chunk.id, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('ac3: chunk bytes decoded under another chunk id are rejected', async () => {
    const a = await encodeChunk(arbitraryLines(2), keys);
    const b = await encodeChunk(arbitraryLines(2), keys);
    expect(a.id).not.toBe(b.id);
    await expect(decodeChunk(a.bytes, b.id, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
    await expect(decodeChunk(b.bytes, a.id, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('ac4: splitIntoChunks keeps every chunk under the limit and preserves the sequence', () => {
    const lines = Array.from({ length: 200 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50 + (i % 37)) }));
    const max = 1024;
    const chunks = splitIntoChunks(lines, max);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const bytes = chunk.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
      expect(bytes).toBeLessThanOrEqual(max);
      expect(chunk.length).toBeGreaterThan(0);
    }
    expect(chunks.flat()).toEqual(lines);
  });

  it('splitIntoChunks puts an oversized line in a chunk of its own instead of failing', () => {
    const big = 'y'.repeat(5000);
    const chunks = splitIntoChunks(['{"a":1}', big, '{"b":2}'], 100);
    expect(chunks).toEqual([['{"a":1}'], [big], ['{"b":2}']]);
    expect(splitIntoChunks([], 100)).toEqual([]);
    expect(() => splitIntoChunks(['x'], 0)).toThrow(/positive/);
  });
});

describe('vault format: refs', () => {
  it('refName derives keyed r/ and m/ names and the fixed header name', () => {
    const r = refName('record', 'vault-1', keys.K_ref);
    const m = refName('machine', 'env-1', keys.K_ref);
    expect(r).toMatch(/^r\/[0-9a-f]{40}$/);
    expect(m).toMatch(/^m\/[0-9a-f]{40}$/);
    expect(refName('record', 'vault-1', keys.K_ref)).toBe(r);
    expect(refName('record', 'vault-2', keys.K_ref)).not.toBe(r);
    expect(refName('record', 'env-1', keys.K_ref).slice(2)).not.toBe(m.slice(2));
    expect(refName('header', 'ignored', keys.K_ref)).toBe(HEADER_REF_NAME);
    expect(refName('record', 'vault-1', deriveSubkeys(createVaultKey()).K_ref)).not.toBe(r);
  });

  it('a session record round-trips and is bound to its ref name', async () => {
    const record = sampleRecord();
    const name = refName('record', record.vaultId, keys.K_ref);
    const bytes = await encryptRef(name, record, keys);
    const read = await readSessionRecord(name, bytes, keys);
    expect(read).toEqual(record);
    expect(isTombstone(read!)).toBe(false);
    await expect(readSessionRecord(refName('record', 'other', keys.K_ref), bytes, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
    const tampered = Buffer.from(bytes);
    tampered[NONCE_BYTES + 1]! ^= 0xff;
    await expect(decryptRef(name, tampered, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('settlements tolerate the reserved wip field being absent or present (PAN-4329 reservation)', async () => {
    const record = sampleRecord();
    const name = refName('record', record.vaultId, keys.K_ref);
    const plain = await readSessionRecord(name, await encryptRef(name, record, keys), keys) as SessionRecord;
    expect(plain.settlements[0]).not.toHaveProperty('wip');
    const withWip: SessionRecord = {
      ...record,
      settlements: [{ ...record.settlements[0]!, wip: { base: 'b'.repeat(40), branch: 'main', tree: 't'.repeat(40), objects: ['c'.repeat(40)], bytes: 1234, at: '2026-09-28T00:00:00.000Z' } }],
    };
    const read = await readSessionRecord(name, await encryptRef(name, withWip, keys), keys) as SessionRecord;
    expect(read.settlements[0]!.wip).toEqual(withWip.settlements[0]!.wip);
    const skipped: SessionRecord = { ...record, settlements: [{ ...record.settlements[0]!, wip: { skipped: 'too-large', bytes: 99 } }] };
    expect(((await readSessionRecord(name, await encryptRef(name, skipped, keys), keys)) as SessionRecord).settlements[0]!.wip).toEqual({ skipped: 'too-large', bytes: 99 });
  });

  it('ac5: a ref value of another type reads as null without throwing', async () => {
    const name = refName('record', 'v-task', keys.K_ref);
    const taskValue = { v: 1, type: 'task', vaultId: 'v-task', title: 'reserved for PAN-2565' };
    const bytes = await encryptRef(name, taskValue as never, keys);
    expect(await readSessionRecord(name, bytes, keys)).toBeNull();
    expect(await readMachineRecord(name, bytes, keys)).toBeNull();
    expect(await decryptRef(name, bytes, keys)).toEqual(taskValue);
  });

  it('tombstones, machine records and the header round-trip', async () => {
    const tomb = { v: 1 as const, type: 'session' as const, vaultId: 'v-9', tombstone: true as const };
    const tombName = refName('record', 'v-9', keys.K_ref);
    const tombRead = await readSessionRecord(tombName, await encryptRef(tombName, tomb, keys), keys);
    expect(tombRead).toEqual(tomb);
    expect(isTombstone(tombRead!)).toBe(true);

    const machine = { v: 1 as const, type: 'machine' as const, environmentId: 'env-1', label: 'laptop', updatedAt: 'now' };
    const machineName = refName('machine', 'env-1', keys.K_ref);
    expect(await readMachineRecord(machineName, await encryptRef(machineName, machine, keys), keys)).toEqual(machine);

    const header = newVaultHeader(new Date(0));
    expect(header.createdAt).toBe('1970-01-01T00:00:00.000Z');
    const headerBytes = await encryptRef(HEADER_REF_NAME, header, keys);
    expect(await readVaultHeader(headerBytes, keys)).toEqual(header);
    await expect(readVaultHeader(headerBytes, deriveSubkeys(createVaultKey()))).rejects.toBeInstanceOf(VaultAuthenticationError);
  });
});
