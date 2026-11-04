import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findShareRecordByScope,
  putShareRecord,
  readShareRecords,
  removeShareRecord,
  sharedSessionsPath,
  type ShareRecord,
} from '../../../../src/lib/sharing/share-record.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;

let testHome: string;

function sampleRecord(scopeId = 'conv-a', hex = 'a'): ShareRecord {
  return {
    scopeKind: 'conversation',
    scopeId,
    hostToken: `odh_${hex.repeat(64)}`,
    joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
    createdAt: '2026-11-02T00:00:00.000Z',
  };
}

describe('share record door', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-share-record-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
  });

  it('putShareRecord then readShareRecords round-trips, and the file mode is 0o600 (ac1)', async () => {
    const record = sampleRecord();
    await putShareRecord('BCDFGHJK', record);

    expect(await readShareRecords()).toEqual({ BCDFGHJK: record });
    expect(JSON.parse(readFileSync(sharedSessionsPath(), 'utf8'))).toEqual({ version: 1, rooms: { BCDFGHJK: record } });
    if (process.platform !== 'win32') {
      expect(statSync(sharedSessionsPath()).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects a second short code for the same conversation, naming the conversation and the existing code (ac2)', async () => {
    await putShareRecord('BCDFGHJK', sampleRecord('conv-x'));
    await expect(putShareRecord('LMNPQRST', sampleRecord('conv-x', 'b'))).rejects.toThrow(
      'A share already exists for conversation conv-x (BCDFGHJK)',
    );
    expect(Object.keys(await readShareRecords())).toEqual(['BCDFGHJK']);
  });

  it('replaces the record when the same short code is written again', async () => {
    await putShareRecord('BCDFGHJK', sampleRecord('conv-x'));
    const replacement = { ...sampleRecord('conv-x', 'c'), joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK?x' };
    await putShareRecord('BCDFGHJK', replacement);
    expect(await readShareRecords()).toEqual({ BCDFGHJK: replacement });
  });

  it('throws naming the path, without any token, on invalid JSON (ac3)', async () => {
    writeFileSync(sharedSessionsPath(), `{"version":1,"rooms":{"BCDFGHJK":{"hostToken":"odh_${'a'.repeat(64)}"`, 'utf8');
    const error = await readShareRecords().then(() => null, (e: unknown) => e as Error);
    expect(error?.message).toContain(sharedSessionsPath());
    expect(error?.message).toContain('Delete it to forget local shares');
    expect(error?.message).not.toContain('odh_');
  });

  it('throws naming the path, without any token, on a malformed host token (ac3)', async () => {
    const bad = { ...sampleRecord(), hostToken: `odh_${'Z'.repeat(64)}` };
    writeFileSync(sharedSessionsPath(), JSON.stringify({ version: 1, rooms: { BCDFGHJK: bad } }), 'utf8');
    const error = await readShareRecords().then(() => null, (e: unknown) => e as Error);
    expect(error?.message).toContain(sharedSessionsPath());
    expect(error?.message).not.toContain('odh_');
  });

  it('throws on an invalid short code key or a wrong version', async () => {
    writeFileSync(sharedSessionsPath(), JSON.stringify({ version: 1, rooms: { abc: sampleRecord() } }), 'utf8');
    await expect(readShareRecords()).rejects.toThrow(sharedSessionsPath());
    writeFileSync(sharedSessionsPath(), JSON.stringify({ version: 2, rooms: {} }), 'utf8');
    await expect(readShareRecords()).rejects.toThrow(sharedSessionsPath());
  });

  it('returns {} without a file, and removeShareRecord of an unknown code returns false (ac4)', async () => {
    expect(await readShareRecords()).toEqual({});
    expect(await removeShareRecord('BCDFGHJK')).toBe(false);
  });

  it('removeShareRecord removes the entry and keeps the file with empty rooms', async () => {
    await putShareRecord('BCDFGHJK', sampleRecord());
    expect(await removeShareRecord('BCDFGHJK')).toBe(true);
    expect(JSON.parse(readFileSync(sharedSessionsPath(), 'utf8'))).toEqual({ version: 1, rooms: {} });
  });

  it('persists both records from two concurrent puts (ac5)', async () => {
    await Promise.all([
      putShareRecord('BCDFGHJK', sampleRecord('conv-a')),
      putShareRecord('LMNPQRST', sampleRecord('conv-b', 'b')),
    ]);
    expect(Object.keys(await readShareRecords()).sort()).toEqual(['BCDFGHJK', 'LMNPQRST']);
  });

  it('findShareRecordByScope finds the record for a conversation, or null', async () => {
    await putShareRecord('BCDFGHJK', sampleRecord('conv-a'));
    expect(await findShareRecordByScope('conversation', 'conv-a')).toEqual({ shortCode: 'BCDFGHJK', record: sampleRecord('conv-a') });
    expect(await findShareRecordByScope('conversation', 'conv-z')).toBeNull();
  });
});
