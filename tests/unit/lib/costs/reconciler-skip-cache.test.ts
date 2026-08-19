import { closeSync, mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcilePiTranscripts } from '../../../../src/lib/costs/reconciler.js';
import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../../../../src/lib/overdeck/infra.js';

let testHome: string;
let agentDir: string;
let previousHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-3743-pi-cache-'));
  previousHome = process.env.HOME;
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = join(testHome, '.overdeck');
  agentDir = join(testHome, '.overdeck', 'agents', 'agent-pan-3743');
  mkdirSync(agentDir, { recursive: true });
  getOverdeckDatabaseSync();
  closeOverdeckDatabaseSync();
});

afterEach(() => {
  closeOverdeckDatabaseSync();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('pi reconcile skip cache', () => {
  it('skips opening an unchanged transcript after caching its terminal verdict', async () => {
    const transcript = join(agentDir, 'session.jsonl');
    writeFileSync(transcript, '{"type":"session","version":3}\n');

    const first = await reconcilePiTranscripts();
    const second = await reconcilePiTranscripts();

    expect(first).toMatchObject({ sessionsScanned: 1, cacheSkipped: 0 });
    expect(second).toMatchObject({ sessionsScanned: 1, cacheSkipped: 1 });
    expect(() => {
      const fd = openSync(transcript, 'r');
      closeSync(fd);
    }).not.toThrow();
  });

  it('retries a file that was unreadable during the previous sweep', async () => {
    const transcript = join(agentDir, 'session.jsonl');
    const missingTarget = join(testHome, 'missing.jsonl');
    symlinkSync(missingTarget, transcript);

    const first = await reconcilePiTranscripts();
    writeFileSync(missingTarget, '{"type":"session","version":3}\n');
    const second = await reconcilePiTranscripts();

    expect(first).toMatchObject({ sessionsScanned: 0, cacheSkipped: 0 });
    expect(second).toMatchObject({ sessionsScanned: 1, cacheSkipped: 0 });
  });
});
