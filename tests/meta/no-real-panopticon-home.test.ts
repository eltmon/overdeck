import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PANOPTICON_SEGMENT = `.${'panopticon'}`;
const REAL_HOME_TARGET = join(homedir(), PANOPTICON_SEGMENT, 'pan-test-guard');

describe('real PANOPTICON_HOME test guard', () => {
  it('sets PANOPTICON_HOME to a per-worker temp directory', () => {
    expect(process.env.PANOPTICON_HOME).toBeTruthy();
    expect(process.env.PANOPTICON_HOME).toContain('pan-test-root-');
    expect(process.env.PANOPTICON_HOME).toContain('worker-');
    expect(process.env.PANOPTICON_HOME).not.toBe(join(homedir(), PANOPTICON_SEGMENT));
  });

  it('blocks sync writes to the real ~/.panopticon tree', () => {
    expect(() => mkdirSync(REAL_HOME_TARGET, { recursive: true })).toThrow('[test-guard]');
    expect(() => writeFileSync(join(REAL_HOME_TARGET, 'file'), 'nope')).toThrow('[test-guard]');
    expect(() => unlinkSync(join(REAL_HOME_TARGET, 'file'))).toThrow('[test-guard]');
    expect(() => rmSync(REAL_HOME_TARGET, { recursive: true, force: true })).toThrow('[test-guard]');
  });

  it('blocks promise writes to the real ~/.panopticon tree', async () => {
    await expect(mkdir(REAL_HOME_TARGET, { recursive: true })).rejects.toThrow('[test-guard]');
    await expect(writeFile(join(REAL_HOME_TARGET, 'file'), 'nope')).rejects.toThrow('[test-guard]');
    await expect(appendFile(join(REAL_HOME_TARGET, 'file'), 'nope')).rejects.toThrow('[test-guard]');
    await expect(rm(REAL_HOME_TARGET, { recursive: true, force: true })).rejects.toThrow('[test-guard]');
  });

  it('has no direct homedir .panopticon write patterns in tests', () => {
    const offenders: string[] = [];
    scanTests(join(process.cwd(), 'tests'), offenders);
    expect(offenders).toEqual([]);
  });
});

function scanTests(dir: string, offenders: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'setup' || entry.name === 'meta') continue;
      scanTests(path, offenders);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const text = readFileSync(path, 'utf-8');
    if (/homedir\(\)[\s\S]{0,120}\.panopticon|\.panopticon[\s\S]{0,120}homedir\(\)/.test(text)) {
      offenders.push(path);
    }
  }
}
