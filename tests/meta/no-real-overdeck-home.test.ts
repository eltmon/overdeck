import { appendFile, copyFile, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OVERDECK_SEGMENT = `.${'overdeck'}`;
const REAL_HOME_TARGET = join(homedir(), OVERDECK_SEGMENT, 'pan-test-guard');
const REAL_CLAUDE_PROJECTS_TARGET = join(homedir(), '.claude', 'projects', '-pan-test-guard');

describe('real OVERDECK_HOME test guard', () => {
  it('sets OVERDECK_HOME to a per-worker temp directory', () => {
    expect(process.env.OVERDECK_HOME).toBeTruthy();
    expect(process.env.OVERDECK_HOME).toContain('pan-test-root-');
    expect(process.env.OVERDECK_HOME).toContain('worker-');
    expect(process.env.OVERDECK_HOME).not.toBe(join(homedir(), OVERDECK_SEGMENT));
  });

  it('blocks sync writes to the real ~/.overdeck tree', () => {
    expect(() => mkdirSync(REAL_HOME_TARGET, { recursive: true })).toThrow('[test-guard]');
    expect(() => writeFileSync(join(REAL_HOME_TARGET, 'file'), 'nope')).toThrow('[test-guard]');
    expect(() => unlinkSync(join(REAL_HOME_TARGET, 'file'))).toThrow('[test-guard]');
    expect(() => rmSync(REAL_HOME_TARGET, { recursive: true, force: true })).toThrow('[test-guard]');
  });

  it('blocks promise writes to the real ~/.overdeck tree', async () => {
    await expect(mkdir(REAL_HOME_TARGET, { recursive: true })).rejects.toThrow('[test-guard]');
    await expect(writeFile(join(REAL_HOME_TARGET, 'file'), 'nope')).rejects.toThrow('[test-guard]');
    await expect(appendFile(join(REAL_HOME_TARGET, 'file'), 'nope')).rejects.toThrow('[test-guard]');
    await expect(rm(REAL_HOME_TARGET, { recursive: true, force: true })).rejects.toThrow('[test-guard]');
  });

  // PAN-3915: a test wrote and then deleted a transcript under the real
  // ~/.claude/projects; those JSONL files are irreplaceable history.
  it('blocks writes and deletes under the real ~/.claude/projects tree', async () => {
    const transcript = join(REAL_CLAUDE_PROJECTS_TARGET, 'session.jsonl');
    expect(() => mkdirSync(REAL_CLAUDE_PROJECTS_TARGET, { recursive: true })).toThrow('[test-guard]');
    expect(() => writeFileSync(transcript, '{}\n')).toThrow('[test-guard]');
    expect(() => unlinkSync(transcript)).toThrow('[test-guard]');
    expect(() => rmSync(REAL_CLAUDE_PROJECTS_TARGET, { recursive: true, force: true })).toThrow('[test-guard]');
    await expect(appendFile(transcript, '{}\n')).rejects.toThrow('[test-guard]');
    await expect(rm(REAL_CLAUDE_PROJECTS_TARGET, { recursive: true, force: true })).rejects.toThrow('[test-guard]');
  });

  it('blocks copyFile and write-mode open into the real home trees', async () => {
    const source = join(process.env.OVERDECK_HOME!, 'pan-3915-copy-source.jsonl');
    writeFileSync(source, '{}\n');
    for (const target of [
      join(REAL_HOME_TARGET, 'file'),
      join(REAL_CLAUDE_PROJECTS_TARGET, 'session.jsonl'),
    ]) {
      expect(() => copyFileSync(source, target)).toThrow('[test-guard]');
      await expect(copyFile(source, target)).rejects.toThrow('[test-guard]');
      expect(() => openSync(target, 'w')).toThrow('[test-guard]');
      expect(() => openSync(target, 'a')).toThrow('[test-guard]');
      await expect(open(target, 'w')).rejects.toThrow('[test-guard]');
      // A read-only open is not a write: it reaches the fs and fails on the missing file.
      expect(() => openSync(target, 'r')).toThrow(/ENOENT/);
    }
  });

  it('has no direct homedir .overdeck write patterns in tests', () => {
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
    if (/homedir\(\)[\s\S]{0,120}\.overdeck|\.overdeck[\s\S]{0,120}homedir\(\)/.test(text)) {
      offenders.push(path);
    }
  }
}
