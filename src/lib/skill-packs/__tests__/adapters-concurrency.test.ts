/**
 * PAN-5238 WI-3: readPackManifest walks pack executables and reads SKILL.md
 * files concurrently through a bounded fs limiter, with output identical to
 * the sequential version — same executables (sorted), same skill dedupe.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCounters } = vi.hoisted(() => {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    getCounters: () => ({
      get inFlight() { return inFlight; },
      set inFlight(v: number) { inFlight = v; },
      get maxInFlight() { return maxInFlight; },
      set maxInFlight(v: number) { maxInFlight = v; },
    }),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const counters = getCounters();
  return {
    ...actual,
    lstat: vi.fn(async (...args: Parameters<typeof actual.lstat>) => {
      counters.inFlight++;
      counters.maxInFlight = Math.max(counters.maxInFlight, counters.inFlight);
      try {
        return await (actual.lstat as (...a: typeof args) => Promise<unknown>)(...args);
      } finally {
        counters.inFlight--;
      }
    }),
  };
});

const { readPackManifest } = await import('../adapters.js');

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-pack-adapter-concurrency-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const counters = getCounters();
  counters.inFlight = 0;
  counters.maxInFlight = 0;
});

describe('readPackManifest concurrency', () => {
  it('walks executables concurrently, at most 32 at a time', async () => {
    const files: Record<string, string> = {
      'skills/a/SKILL.md': skillMd('a', 'A.'),
    };
    const shFiles = ['a.sh', 'm.sh', 'z.sh'];
    for (const name of shFiles) {
      files[`skills/a/scripts/${name}`] = 'echo hi\n';
    }
    for (let i = 0; i < 37; i++) {
      files[`skills/a/scripts/file-${String(i).padStart(2, '0')}.ts`] = '// not executable\n';
    }
    const root = fixture(files);

    const manifest = await readPackManifest(root, 'plain');

    const counters = getCounters();
    expect(counters.maxInFlight).toBeGreaterThan(1);
    expect(counters.maxInFlight).toBeLessThanOrEqual(32);
    expect(manifest.capabilities.executables).toEqual([
      'skills/a/scripts/a.sh',
      'skills/a/scripts/m.sh',
      'skills/a/scripts/z.sh',
    ]);
  });

  it('dedupes same-named skills and excludes the dropped dir from executables', async () => {
    const root = fixture({
      'skills/a/SKILL.md': skillMd('same', 'From a.'),
      'skills/a/scripts/run.sh': 'echo a\n',
      'skills/b/SKILL.md': skillMd('same', 'From b.'),
      'skills/b/scripts/run.sh': 'echo b\n',
    });

    const manifest = await readPackManifest(root, 'plain');

    expect(manifest.skills.filter((s) => s.name === 'same')).toHaveLength(1);
    expect(manifest.skills.find((s) => s.name === 'same')?.dir).toBe('skills/a');
    expect(manifest.capabilities.executables).toEqual(['skills/a/scripts/run.sh']);
  });
});
