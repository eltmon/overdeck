/**
 * PAN-4680: queueLedgerEntry used to start each append immediately and only
 * track the promise in a Set, so two appends queued back to back raced
 * through `await mkdir`/`await appendFile` and the ledger file held lines
 * in completion order instead of call order. These tests pin the append
 * chain's call-order guarantee, its call-time stamping, and its failure
 * isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mkdirMock, appendFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  appendFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: mkdirMock,
    appendFile: appendFileMock,
  };
});

import {
  appendLedgerEntry,
  flushLedgerWrites,
  queueLedgerEntry,
  readLedgerWindow,
  type LedgerEntryInput,
} from '../../../../src/lib/github-quota/ledger.js';

const actualFsPromises = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

function entry(cost: number, overrides: Partial<LedgerEntryInput> = {}): LedgerEntryInput {
  return {
    kind: 'call',
    caller: 'pr-cache',
    pool: 'user',
    bucket: 'graphql',
    cost,
    estimated: false,
    outcome: 'ok',
    ...overrides,
  };
}

/** Gates the next `mkdir` call behind `gate`, then runs the real `mkdir`. */
function gateNextMkdir(): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  mkdirMock.mockImplementationOnce(async (...args: Parameters<typeof actualFsPromises.mkdir>) => {
    await gate;
    return actualFsPromises.mkdir(...args);
  });
  return release;
}

describe('ledger append queue ordering (PAN-4680)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-ledger-queue-'));
    process.env.OVERDECK_HOME = home;
    mkdirMock.mockReset().mockImplementation((...args: Parameters<typeof actualFsPromises.mkdir>) => actualFsPromises.mkdir(...args));
    appendFileMock.mockReset().mockImplementation((...args: Parameters<typeof actualFsPromises.appendFile>) => actualFsPromises.appendFile(...args));
  });

  afterEach(async () => {
    await flushLedgerWrites().catch(() => undefined);
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('appends queued entries in call order even when the first mkdir is slow', async () => {
    const release = gateNextMkdir();

    queueLedgerEntry(entry(1));
    queueLedgerEntry(entry(2));
    queueLedgerEntry(entry(3));

    await new Promise((r) => setImmediate(r));
    try {
      expect(mkdirMock).toHaveBeenCalledTimes(1);
      expect(appendFileMock).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await flushLedgerWrites();

    expect(readLedgerWindow(Date.now()).map((e) => e.cost)).toEqual([1, 2, 3]);
  });

  it('orders a direct append after the queued appends started before it', async () => {
    const release = gateNextMkdir();

    queueLedgerEntry(entry(1));
    const direct = appendLedgerEntry(entry(2));
    queueLedgerEntry(entry(3));

    release();
    await direct;

    expect(readLedgerWindow(Date.now()).map((e) => e.cost)).toEqual([1, 2]);

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now()).map((e) => e.cost)).toEqual([1, 2, 3]);
  });

  it('stamps and places a queued entry at call time, not at write time', async () => {
    const homeB = mkdtempSync(join(tmpdir(), 'pan-ledger-queue-b-'));
    try {
      const release = gateNextMkdir();
      const queuedAt = Date.now() - 60_000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(queuedAt);

      queueLedgerEntry(entry(1));
      queueLedgerEntry(entry(2));

      nowSpy.mockReturnValue(queuedAt + 30_000);
      process.env.OVERDECK_HOME = homeB;

      release();
      await flushLedgerWrites();
      nowSpy.mockRestore();

      expect(existsSync(join(homeB, 'github-quota'))).toBe(false);

      process.env.OVERDECK_HOME = home;
      const entries = readLedgerWindow(Date.now());
      expect(entries.map((e) => e.cost)).toEqual([1, 2]);
      expect(entries.map((e) => e.ts)).toEqual([new Date(queuedAt).toISOString(), new Date(queuedAt).toISOString()]);
    } finally {
      rmSync(homeB, { recursive: true, force: true });
    }
  });
});

describe('ledger append queue failure isolation (PAN-4680)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-ledger-queue-fail-'));
    process.env.OVERDECK_HOME = home;
    mkdirMock.mockReset().mockImplementation((...args: Parameters<typeof actualFsPromises.mkdir>) => actualFsPromises.mkdir(...args));
    appendFileMock.mockReset().mockImplementation((...args: Parameters<typeof actualFsPromises.appendFile>) => actualFsPromises.appendFile(...args));
  });

  afterEach(async () => {
    await flushLedgerWrites().catch(() => undefined);
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('a rejected append does not stop later appends', async () => {
    appendFileMock.mockImplementationOnce(() => Promise.reject(new Error('EIO')));

    queueLedgerEntry(entry(1));
    queueLedgerEntry(entry(2));
    queueLedgerEntry(entry(3));

    await expect(flushLedgerWrites()).resolves.toBeUndefined();
    expect(readLedgerWindow(Date.now()).map((e) => e.cost)).toEqual([2, 3]);
  });

  it('a rejected direct append resolves for its caller', async () => {
    appendFileMock.mockImplementationOnce(() => Promise.reject(new Error('EIO')));

    await expect(appendLedgerEntry(entry(1))).resolves.toBeUndefined();
    await appendLedgerEntry(entry(2));

    expect(readLedgerWindow(Date.now()).map((e) => e.cost)).toEqual([2]);
  });
});
