/**
 * PAN-4730 WI-O3: the gstack browser-runtime runner, against a fixture
 * extraction whose `setup` is a fake bash script (no real gstack, no bun
 * install, no Chromium, no network).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBrowserBuildable,
  BrowserError,
  browserCommand,
  browserDownloads,
  buildBrowserRuntime,
  isBrowserReady,
} from '../browser.js';

const COMMIT = 'b'.repeat(40);
const dirs: string[] = [];

type SetupVariant = 'ok' | 'exit3' | 'no-marker';

// args: --pack-browser R --pack-browser-cache C
const SETUP_BODY: Record<SetupVariant, string> = {
  ok: [
    'mkdir -p "$4/playwright"',
    'printf \'{"packBrowser":1,"browsersPath":"%s/playwright","version":"0.0.0"}\\n\' "$4" > "$2/.gstack-pack-browser.json"',
  ].join('\n'),
  exit3: ['echo "pack browser: boom" >&2', 'exit 3'].join('\n'),
  'no-marker': 'true',
};

const PACKAGE_JSON = JSON.stringify({
  name: 'gstack',
  dependencies: { playwright: '^1.62.1', diff: '^9.0.0', '@anthropic-ai/sdk': '^0.78.0', sharp: '^0.35.4' },
});

/** A temp root holding a ready render dir and an extraction with `pack-mode.json`, `package.json` and a fake `setup`. */
function fixture(variant: SetupVariant, opts: { packMode?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skill-pack-browser-'));
  dirs.push(root);
  const extractDir = join(root, 'extract');
  const renderDir = join(root, 'packs', 'gstack', 'render', COMMIT);
  mkdirSync(extractDir);
  mkdirSync(renderDir, { recursive: true });
  writeFileSync(join(renderDir, '.gstack-pack.json'), '{"packMode":1}\n');
  const sentinel = join(root, 'setup-ran');
  writeFileSync(join(extractDir, 'setup'), `#!/usr/bin/env bash\nset -e\ntouch "${sentinel}"\n${SETUP_BODY[variant]}\n`);
  writeFileSync(join(extractDir, 'pack-mode.json'), opts.packMode ?? '{"packMode": 1, "packBrowser": 1}\n');
  writeFileSync(join(extractDir, 'package.json'), PACKAGE_JSON);
  return { extractDir, sentinel, renderDir, cacheDir: join(root, 'packs', 'gstack', 'browser') };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('browserCommand', () => {
  it('is the fork pack-browser invocation', () => {
    expect(browserCommand('/r', '/c')).toEqual(['bash', 'setup', '--pack-browser', '/r', '--pack-browser-cache', '/c']);
  });
});

describe('buildBrowserRuntime', () => {
  it('builds into the render and creates the cache dir', async () => {
    const f = fixture('ok');
    await buildBrowserRuntime({ ...f, commit: COMMIT });
    expect(await isBrowserReady(f.renderDir)).toBe(true);
    expect(existsSync(join(f.cacheDir, 'playwright'))).toBe(true);
  });

  it('reports the stderr tail when the step fails', async () => {
    const f = fixture('exit3');
    const error = await buildBrowserRuntime({ ...f, commit: COMMIT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserError);
    expect((error as Error).message).toBe('pack gstack: browser build failed: pack browser: boom');
    expect(await isBrowserReady(f.renderDir)).toBe(false);
  });

  it('fails when the step exits 0 without the ready marker', async () => {
    const f = fixture('no-marker');
    await expect(buildBrowserRuntime({ ...f, commit: COMMIT })).rejects.toThrow(
      'pack gstack: browser build wrote no .gstack-pack-browser.json',
    );
  });

  it('rejects a commit without packBrowser before setup runs', async () => {
    for (const packMode of ['{"packMode": 1}\n', '{"packMode": 1, "packBrowser": 2}\n', '{']) {
      const f = fixture('ok', { packMode });
      await expect(buildBrowserRuntime({ ...f, commit: COMMIT })).rejects.toThrow(
        'pack gstack: bbbbbbb has no browser step (pack-mode.json packBrowser); update to an eltmon/gstack commit with it',
      );
      expect(existsSync(f.sentinel)).toBe(false);
      expect(existsSync(f.cacheDir)).toBe(false);
    }
  });

  it('requires bun on PATH', async () => {
    const f = fixture('ok');
    const bin = mkdtempSync(join(tmpdir(), 'skill-pack-browser-path-'));
    dirs.push(bin);
    symlinkSync('/bin/bash', join(bin, 'bash'));
    const path = process.env['PATH'];
    process.env['PATH'] = bin;
    try {
      await expect(assertBrowserBuildable(f.extractDir, COMMIT)).rejects.toThrow('pack gstack needs bun on PATH (https://bun.sh)');
    } finally {
      process.env['PATH'] = path;
    }
  });
});

describe('isBrowserReady', () => {
  it('is false without the marker, with a bad marker, or with another packBrowser', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pack-browser-ready-'));
    dirs.push(root);
    expect(await isBrowserReady(join(root, 'missing'))).toBe(false);
    writeFileSync(join(root, '.gstack-pack-browser.json'), '{');
    expect(await isBrowserReady(root)).toBe(false);
    writeFileSync(join(root, '.gstack-pack-browser.json'), '{"packBrowser":2}');
    expect(await isBrowserReady(root)).toBe(false);
    writeFileSync(join(root, '.gstack-pack-browser.json'), '{"packBrowser":1}');
    expect(await isBrowserReady(root)).toBe(true);
  });
});

describe('browserDownloads', () => {
  it('lists every production dependency, sorted, then the lockfile and Chromium lines', async () => {
    const f = fixture('ok');
    expect(await browserDownloads(f.extractDir)).toEqual([
      '@anthropic-ai/sdk@^0.78.0',
      'diff@^9.0.0',
      'playwright@^1.62.1',
      'sharp@^0.35.4',
      '+ their locked dependencies from bun.lock (registry.npmjs.org)',
      'Chromium, Chromium headless shell and ffmpeg for playwright ^1.62.1 (Playwright CDN, ~115 MiB download)',
    ]);
  });

  it('says so when package.json is missing or unreadable', async () => {
    const f = fixture('ok');
    writeFileSync(join(f.extractDir, 'package.json'), '{');
    expect(await browserDownloads(f.extractDir)).toEqual(['unknown: package.json not readable']);
    expect(await browserDownloads(join(f.extractDir, 'missing'))).toEqual(['unknown: package.json not readable']);
  });
});
