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
  decodeWipParts,
  decryptRef,
  encodeChunk,
  encodeWipParts,
  encryptRef,
  isTombstone,
  newVaultHeader,
  parseKeyRing,
  readMachineRecord,
  readSessionRecord,
  readVaultHeader,
  refName,
  splitIntoChunks,
  type RetiredRefMarker,
  type SessionRecord,
  type VaultHeader,
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

describe('vault format: key ring (PAN-4333)', () => {
  const retiredKey = createVaultKey();
  const retired = deriveSubkeys(retiredKey);
  const older = deriveSubkeys(createVaultKey());
  const current = { ...deriveSubkeys(createVaultKey()), previous: [retired, older] };

  it("ring.ac1: a chunk encoded under K decodes with keys(K').previous=[keys(K)]", async () => {
    const lines = arbitraryLines(12);
    const chunk = await encodeChunk(lines, retired);
    const decoded = await decodeChunk(chunk.bytes, chunk.id, { ...deriveSubkeys(createVaultKey()), previous: [retired] });
    expect(decoded.lines).toEqual(lines);
    expect(decoded.lineHashes).toEqual(chunk.lineHashes);
    // Any ring position works, and the current key still decodes its own chunks.
    const oldest = await encodeChunk(lines, older);
    expect((await decodeChunk(oldest.bytes, oldest.id, current)).lines).toEqual(lines);
    const fresh = await encodeChunk(lines, current);
    expect((await decodeChunk(fresh.bytes, fresh.id, current)).lines).toEqual(lines);
    // Encoding ignores the ring: the id and seal come from the current key only.
    expect(fresh.id).toBe(chunkIdFor(Buffer.from(JSON.stringify({ v: 1, codec: 'zstd', lineHashes: fresh.lineHashes, lines })), current.K_id));
    await expect(decodeChunk(fresh.bytes, fresh.id, retired)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('ring.ac2: a WIP part encoded under K decodes through the ring', async () => {
    const bundle = randomBytes(4096);
    const parts = await encodeWipParts(bundle, retired);
    expect((await decodeWipParts(parts, current)).equals(bundle)).toBe(true);
    // Parts sealed under different keys of the ring decode in one call.
    const tail = randomBytes(512);
    const mixed = [...parts, ...(await encodeWipParts(tail, current))];
    expect((await decodeWipParts(mixed, current)).equals(Buffer.concat([bundle, tail]))).toBe(true);
    await expect(decodeWipParts(parts, deriveSubkeys(createVaultKey()))).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('ring.ac3: with no key matching, decodeChunk throws VaultAuthenticationError', async () => {
    const chunk = await encodeChunk(arbitraryLines(3), deriveSubkeys(createVaultKey()));
    await expect(decodeChunk(chunk.bytes, chunk.id, current)).rejects.toBeInstanceOf(VaultAuthenticationError);
    await expect(decodeChunk(chunk.bytes, chunk.id, { ...current, previous: [] })).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('ring.ac4: parseKeyRing rejects a 31-byte entry', () => {
    const header = newVaultHeader(new Date(0));
    const good = retiredKey.toString('base64');
    expect(parseKeyRing({ ...header, keyRing: [good] })).toEqual([retiredKey]);
    const malformed = 'Vault header key ring is malformed';
    expect(() => parseKeyRing({ ...header, keyRing: [good, randomBytes(31).toString('base64')] })).toThrow(malformed);
    expect(() => parseKeyRing({ ...header, keyRing: [randomBytes(33).toString('base64')] })).toThrow(malformed);
    // 32 bytes, but not the canonical base64 spelling.
    expect(() => parseKeyRing({ ...header, keyRing: [good.replace(/=+$/, '')] })).toThrow(malformed);
    expect(() => parseKeyRing({ ...header, keyRing: [` ${good}`] })).toThrow(malformed);
    expect(() => parseKeyRing({ ...header, keyRing: [7] } as unknown as VaultHeader)).toThrow(malformed);
    expect(() => parseKeyRing({ ...header, keyRing: good } as unknown as VaultHeader)).toThrow(malformed);
  });

  it('ring.ac5: a header without keyRing parses to an empty ring', async () => {
    const header = newVaultHeader(new Date(0));
    expect(parseKeyRing(header)).toEqual([]);
    const rotated: VaultHeader = { ...header, rotatedAt: '2026-09-29T00:00:00.000Z', keyRing: [retiredKey.toString('base64')] };
    const read = await readVaultHeader(await encryptRef(HEADER_REF_NAME, rotated, current), current);
    expect(read).toEqual(rotated);
    expect(parseKeyRing(read!)).toEqual([retiredKey]);
    // The header is sealed under the current key only; a ring key does not open it.
    await expect(readVaultHeader(await encryptRef(HEADER_REF_NAME, rotated, current), { ...retired, previous: [current] }))
      .rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('a retired-ref marker seals under the retired key and reads as no session or machine', async () => {
    const marker: RetiredRefMarker = { v: 1, type: 'retired', at: '2026-09-29T00:00:00.000Z' };
    const name = refName('record', 'v-1', retired.K_ref);
    const bytes = await encryptRef(name, marker, retired);
    expect(await decryptRef(name, bytes, retired)).toEqual(marker);
    expect(await readSessionRecord(name, bytes, retired)).toBeNull();
    expect(await readMachineRecord(name, bytes, retired)).toBeNull();
    await expect(decryptRef(name, bytes, current)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });
});
