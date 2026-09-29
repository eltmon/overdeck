/**
 * The shared cwd-containment check (PAN-4338, collapsing the conversation-forks.ts
 * and conversation-runtime.ts copies): accepts an existing directory under
 * $HOME, rejects everything else.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateCwdContainment } from '../cwd-containment.js';

describe('validateCwdContainment', () => {
  let testHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    testHome = join(tmpdir(), `pan-4338-cwd-containment-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.HOME = testHome;
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('accepts an existing directory under $HOME', async () => {
    const dir = join(testHome, 'project');
    mkdirSync(dir);
    await expect(validateCwdContainment(dir)).resolves.toBe(true);
  });

  it('accepts $HOME itself', async () => {
    await expect(validateCwdContainment(testHome)).resolves.toBe(true);
  });

  it('rejects a relative path', async () => {
    await expect(validateCwdContainment('project')).resolves.toBe(false);
  });

  it("rejects a path containing a '..' segment", async () => {
    mkdirSync(join(testHome, 'a'));
    // `join()` normalizes '..' away, so build the literal segment by hand.
    const dir = `${testHome}/a/../a`;
    await expect(validateCwdContainment(dir)).resolves.toBe(false);
  });

  it('rejects a missing directory', async () => {
    await expect(validateCwdContainment(join(testHome, 'missing'))).resolves.toBe(false);
  });

  it('rejects a file', async () => {
    const file = join(testHome, 'file.txt');
    writeFileSync(file, 'x');
    await expect(validateCwdContainment(file)).resolves.toBe(false);
  });

  it('rejects a directory outside $HOME', async () => {
    const outside = join(tmpdir(), `pan-4338-outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    try {
      await expect(validateCwdContainment(outside)).resolves.toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
