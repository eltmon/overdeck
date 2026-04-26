import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// Mock homedir so installation goes to a temp dir, not ~/.panopticon
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn() };
});

// Mock fileURLToPath so findVendoredDir() points at our temp dist/cli/ dir
vi.mock('url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('url')>();
  return { ...actual, fileURLToPath: vi.fn() };
});

import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { setupCavemanHooks, setupCavemanCompressScripts, getCavemanHooksDir, getCavemanSkillsDir } from '../setup.js';

const mockHomedir = vi.mocked(homedir);
const mockFileURLToPath = vi.mocked(fileURLToPath);

let testBase: string;
let fakeHome: string;
let fakeDistCliDir: string;
let fakeVendoredDir: string;

function createFakeVendoredFiles() {
  mkdirSync(fakeVendoredDir, { recursive: true });
  mkdirSync(join(fakeVendoredDir, 'skills', 'caveman'), { recursive: true });
  mkdirSync(join(fakeVendoredDir, 'skills', 'caveman-review'), { recursive: true });
  for (const f of ['caveman-activate.js', 'caveman-mode-tracker.js', 'caveman-config.js', 'panopticon-caveman-activate.js']) {
    writeFileSync(join(fakeVendoredDir, f), `// ${f}`);
  }
  writeFileSync(join(fakeVendoredDir, 'caveman-statusline.sh'), 'echo caveman');
  writeFileSync(join(fakeVendoredDir, 'skills', 'caveman', 'SKILL.md'), '# Caveman SKILL');
  writeFileSync(join(fakeVendoredDir, 'skills', 'caveman-review', 'SKILL.md'), '# Caveman Review SKILL');
}

beforeEach(() => {
  testBase = join(tmpdir(), `caveman-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fakeHome = join(testBase, 'home');
  fakeDistCliDir = join(testBase, 'dist', 'cli');
  fakeVendoredDir = join(fakeDistCliDir, 'caveman');
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(fakeDistCliDir, { recursive: true });

  mockHomedir.mockReturnValue(fakeHome);
  // setup.ts does: dirname(fileURLToPath(import.meta.url)) → should be fakeDistCliDir
  mockFileURLToPath.mockReturnValue(join(fakeDistCliDir, 'index.js'));
});

afterEach(() => {
  rmSync(testBase, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── getCavemanHooksDir / getCavemanSkillsDir ──────────────��──────────────────

describe('getCavemanHooksDir', () => {
  it('builds path from homedir', () => {
    const dir = getCavemanHooksDir();
    expect(dir).toBe(join(fakeHome, '.panopticon', 'hooks', 'caveman'));
  });
});

describe('getCavemanSkillsDir', () => {
  it('builds path from homedir', () => {
    const dir = getCavemanSkillsDir();
    expect(dir).toBe(join(fakeHome, '.panopticon', 'hooks', 'skills'));
  });
});

// ─── setupCavemanHooks ────────────────────────────────────────────────────────

describe('setupCavemanHooks', () => {
  it('returns false when vendored directory does not exist', () => {
    expect(setupCavemanHooks()).toBe(false);
  });

  it('returns false when a required JS file is missing', () => {
    mkdirSync(fakeVendoredDir, { recursive: true });
    // Create all except caveman-activate.js
    for (const f of ['caveman-mode-tracker.js', 'caveman-config.js', 'panopticon-caveman-activate.js']) {
      writeFileSync(join(fakeVendoredDir, f), `// ${f}`);
    }
    expect(setupCavemanHooks()).toBe(false);
  });

  it('returns false when SKILL.md files are missing', () => {
    mkdirSync(fakeVendoredDir, { recursive: true });
    for (const f of ['caveman-activate.js', 'caveman-mode-tracker.js', 'caveman-config.js', 'panopticon-caveman-activate.js']) {
      writeFileSync(join(fakeVendoredDir, f), `// ${f}`);
    }
    // No skills/ directory — SKILL.md files are missing
    expect(setupCavemanHooks()).toBe(false);
  });

  it('returns true and installs all files on success', () => {
    createFakeVendoredFiles();

    expect(setupCavemanHooks()).toBe(true);

    const hooksDir = getCavemanHooksDir();
    expect(existsSync(join(hooksDir, 'panopticon-caveman-activate.js'))).toBe(true);
    expect(existsSync(join(hooksDir, 'caveman-activate.js'))).toBe(true);
    expect(existsSync(join(hooksDir, 'caveman-statusline.sh'))).toBe(true);

    const skillsDir = getCavemanSkillsDir();
    expect(existsSync(join(skillsDir, 'caveman', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'caveman-review', 'SKILL.md'))).toBe(true);
  });

  it('is idempotent — returns true on repeated calls', () => {
    createFakeVendoredFiles();
    expect(setupCavemanHooks()).toBe(true);
    expect(setupCavemanHooks()).toBe(true);
  });
});

// ─── setupCavemanCompressScripts ──────────────────────────���──────────────────

describe('setupCavemanCompressScripts', () => {
  it('returns false when compress source directory does not exist', () => {
    expect(setupCavemanCompressScripts()).toBe(false);
  });

  it('returns true and installs .py files on success', () => {
    const compressSrc = join(fakeDistCliDir, 'caveman-compress');
    mkdirSync(compressSrc, { recursive: true });
    const pyFiles = ['__init__.py', '__main__.py', 'cli.py', 'compress.py', 'detect.py'];
    for (const f of pyFiles) {
      writeFileSync(join(compressSrc, f), `# ${f}`);
    }

    expect(setupCavemanCompressScripts()).toBe(true);

    const destDir = join(fakeHome, '.panopticon', 'hooks', 'caveman-compress');
    for (const f of pyFiles) {
      expect(existsSync(join(destDir, f))).toBe(true);
    }
  });
});

// ─── vendored JS file load validation ────────────────────────────────────────
//
// Verifies that the three CJS hook scripts have no syntax errors and that
// caveman-config.js exports the expected symbols. Uses a temp directory with
// no package.json so Node treats .js files as CommonJS (matching the actual
// runtime context in ~/.panopticon/hooks/caveman/ where no package.json exists).

describe('vendored JS files — syntax and load validation', () => {
  // The caveman source directory relative to this test file.
  // import.meta.url → file://.../src/lib/caveman/__tests__/setup.test.ts
  // new URL('..', ...) → file://.../src/lib/caveman/
  // Use .pathname directly — fileURLToPath is mocked in this file.
  const cavemanSrcDir = new URL('..', import.meta.url).pathname;

  const hookFiles = [
    'caveman-config.js',
    'caveman-activate.js',
    'caveman-mode-tracker.js',
  ] as const;

  for (const file of hookFiles) {
    it(`${file} passes node --check (no syntax errors)`, () => {
      const result = spawnSync(process.execPath, ['--check', join(cavemanSrcDir, file)], {
        encoding: 'utf-8',
      });
      expect(result.stderr, `${file} had syntax errors:\n${result.stderr}`).toBe('');
      expect(result.status).toBe(0);
    });
  }

  it('caveman-config.js exports getDefaultMode, getConfigDir, getConfigPath, VALID_MODES when loaded as CJS', () => {
    // Copy to a temp dir with no package.json → Node treats .js as CommonJS
    const tmpDir = mkdtempSync(join(tmpdir(), 'caveman-load-'));
    try {
      copyFileSync(join(cavemanSrcDir, 'caveman-config.js'), join(tmpDir, 'caveman-config.js'));
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `const m = require('./caveman-config.js');
const keys = Object.keys(m).sort();
process.stdout.write(JSON.stringify(keys));`,
        ],
        { cwd: tmpDir, encoding: 'utf-8' },
      );
      expect(result.stderr, `caveman-config.js failed to load:\n${result.stderr}`).toBe('');
      expect(result.status).toBe(0);
      const keys: string[] = JSON.parse(result.stdout);
      expect(keys).toContain('getDefaultMode');
      expect(keys).toContain('getConfigDir');
      expect(keys).toContain('getConfigPath');
      expect(keys).toContain('VALID_MODES');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
