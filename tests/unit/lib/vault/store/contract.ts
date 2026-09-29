/**
 * Shared VaultStore contract suite (PAN-2609). Every backend must pass it.
 * Call from a `*.test.ts` file with a factory that yields a fresh, empty store.
 */
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { KEYWRAP_OBJECT_NAME, type VaultStore } from '../../../../../src/lib/vault/store/types.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const ID_C = '0123456789abcdef0123456789abcdef01234567';

export function runVaultStoreContract(makeStore: () => Promise<VaultStore>): void {
  describe('VaultStore contract', () => {
    it('putObjects stores bytes and getObject returns them; missing ids are null', async () => {
      const store = await makeStore();
      const bytesA = randomBytes(1024);
      const bytesB = new Uint8Array([0, 255, 10, 13]);
      await store.putObjects([{ id: ID_A, bytes: bytesA }, { id: ID_B, bytes: bytesB }]);
      expect(Buffer.from((await store.getObject(ID_A))!).equals(bytesA)).toBe(true);
      expect(Buffer.from((await store.getObject(ID_B))!).equals(Buffer.from(bytesB))).toBe(true);
      expect(await store.getObject(ID_C)).toBeNull();
    });

    it('ac3: putObjects is idempotent for the same id and bytes', async () => {
      const store = await makeStore();
      const bytes = randomBytes(64);
      await store.putObjects([{ id: ID_A, bytes }]);
      await expect(store.putObjects([{ id: ID_A, bytes }])).resolves.toBeUndefined();
      expect(Buffer.from((await store.getObject(ID_A))!).equals(bytes)).toBe(true);
      // Same id, different ciphertext (fresh nonce after a failed push): stored once, first bytes win.
      await expect(store.putObjects([{ id: ID_A, bytes: randomBytes(64) }])).resolves.toBeUndefined();
      expect(Buffer.from((await store.getObject(ID_A))!).equals(bytes)).toBe(true);
    });

    it('hasObjects returns exactly the present subset', async () => {
      const store = await makeStore();
      await store.putObjects([{ id: ID_A, bytes: randomBytes(8) }]);
      expect(await store.hasObjects([ID_A, ID_B, ID_C])).toEqual(new Set([ID_A]));
      expect(await store.hasObjects([])).toEqual(new Set());
    });

    it('readRef of a missing ref is null; casRef with null creates it', async () => {
      const store = await makeStore();
      expect(await store.readRef('r/' + ID_A)).toBeNull();
      const value = randomBytes(32);
      expect(await store.casRef('r/' + ID_A, null, value)).toBe('ok');
      const ref = await store.readRef('r/' + ID_A);
      expect(ref).not.toBeNull();
      expect(Buffer.from(ref!.value).equals(value)).toBe(true);
      expect(typeof ref!.version).toBe('string');
      expect(ref!.version.length).toBeGreaterThan(0);
    });

    it('casRef replaces only when the expected version matches', async () => {
      const store = await makeStore();
      const name = 'h/header';
      await store.casRef(name, null, Buffer.from('v1'));
      const first = (await store.readRef(name))!;
      expect(await store.casRef(name, null, Buffer.from('again'))).toBe('conflict');
      expect(await store.casRef(name, 'not-the-version', Buffer.from('nope'))).toBe('conflict');
      expect(Buffer.from((await store.readRef(name))!.value).toString()).toBe('v1');
      expect(await store.casRef(name, first.version, Buffer.from('v2'))).toBe('ok');
      const second = (await store.readRef(name))!;
      expect(Buffer.from(second.value).toString()).toBe('v2');
      expect(second.version).not.toBe(first.version);
      expect(await store.casRef(name, first.version, Buffer.from('stale'))).toBe('conflict');
    });

    it('ac2: two concurrent casRef calls with the same expected version yield exactly one ok', async () => {
      const store = await makeStore();
      const name = 'r/' + ID_B;
      await store.casRef(name, null, Buffer.from('base'));
      const { version } = (await store.readRef(name))!;
      const results = await Promise.all([
        store.casRef(name, version, Buffer.from('writer-1')),
        store.casRef(name, version, Buffer.from('writer-2')),
      ]);
      expect(results.filter((result) => result === 'ok')).toHaveLength(1);
      expect(results.filter((result) => result === 'conflict')).toHaveLength(1);
      const final = Buffer.from((await store.readRef(name))!.value).toString();
      expect(['writer-1', 'writer-2']).toContain(final);

      const creates = await Promise.all([
        store.casRef('m/' + ID_C, null, Buffer.from('m1')),
        store.casRef('m/' + ID_C, null, Buffer.from('m2')),
      ]);
      expect(creates.sort()).toEqual(['conflict', 'ok']);
    });

    it('putSlot creates the reserved keywrap/v1 slot and getObject/hasObjects read it', async () => {
      const store = await makeStore();
      expect(await store.getObject(KEYWRAP_OBJECT_NAME)).toBeNull();
      expect(await store.hasObjects([KEYWRAP_OBJECT_NAME, ID_A])).toEqual(new Set());
      const wrapped = randomBytes(96);
      await store.putSlot(KEYWRAP_OBJECT_NAME, wrapped);
      expect(Buffer.from((await store.getObject(KEYWRAP_OBJECT_NAME))!).equals(wrapped)).toBe(true);
      expect(await store.hasObjects([KEYWRAP_OBJECT_NAME])).toEqual(new Set([KEYWRAP_OBJECT_NAME]));
      await expect(store.getObject('keywrap/v2')).rejects.toThrow(/Invalid vault object id/);
    });

    it('store-slot.ac1: putSlot overwrites, deletes with null, and a second delete resolves', async () => {
      const store = await makeStore();
      const first = randomBytes(96);
      const second = randomBytes(96);
      await store.putSlot(KEYWRAP_OBJECT_NAME, first);
      await store.putSlot(KEYWRAP_OBJECT_NAME, second);
      expect(Buffer.from((await store.getObject(KEYWRAP_OBJECT_NAME))!).equals(second)).toBe(true);
      // Re-setting identical bytes is a no-op, not an error.
      await expect(store.putSlot(KEYWRAP_OBJECT_NAME, second)).resolves.toBeUndefined();
      await store.putSlot(KEYWRAP_OBJECT_NAME, null);
      expect(await store.getObject(KEYWRAP_OBJECT_NAME)).toBeNull();
      expect(await store.hasObjects([KEYWRAP_OBJECT_NAME])).toEqual(new Set());
      await expect(store.putSlot(KEYWRAP_OBJECT_NAME, null)).resolves.toBeUndefined();
    });

    it('store-slot.ac2: putSlot rejects non-slot names and putObjects rejects the slot; nothing is written', async () => {
      const store = await makeStore();
      await expect(store.putSlot(ID_A, randomBytes(8))).rejects.toThrow(/Invalid vault slot name/);
      await expect(store.putSlot('keywrap/v2', randomBytes(8))).rejects.toThrow(/Invalid vault slot name/);
      await expect(store.putObjects([
        { id: ID_B, bytes: randomBytes(8) },
        { id: KEYWRAP_OBJECT_NAME, bytes: randomBytes(96) },
      ])).rejects.toThrow('Reserved vault object keywrap/v1 must be written with putSlot');
      expect(await store.hasObjects([ID_A, ID_B, KEYWRAP_OBJECT_NAME])).toEqual(new Set());
    });

    it('listRefs filters by prefix and reports current versions', async () => {
      const store = await makeStore();
      await store.casRef('r/' + ID_A, null, Buffer.from('a'));
      await store.casRef('r/' + ID_B, null, Buffer.from('b'));
      await store.casRef('m/' + ID_C, null, Buffer.from('m'));
      await store.casRef('h/header', null, Buffer.from('h'));
      const records = await store.listRefs('r/');
      expect(records.map((ref) => ref.name)).toEqual(['r/' + ID_A, 'r/' + ID_B]);
      expect(records[0]!.version).toBe((await store.readRef('r/' + ID_A))!.version);
      expect((await store.listRefs('m/')).map((ref) => ref.name)).toEqual(['m/' + ID_C]);
      expect((await store.listRefs('h/')).map((ref) => ref.name)).toEqual(['h/header']);
      expect(await store.listRefs('z/')).toEqual([]);
      expect((await store.listRefs('')).length).toBe(4);
    });
  });
}
