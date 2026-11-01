/**
 * PAN-4730 WI-O5/O6: the gstack browser-runtime consent flows (enable,
 * disable, update, sync) against real files under a temp OVERDECK_HOME and a
 * local bare repo whose fake `setup` follows the fork's pack-mode and
 * pack-browser contracts (no bun install, no Chromium, no network).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-browser-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { getGlobalConfigPath } from '../../config-yaml/load.js';
import {
  addPack,
  disablePackBrowser,
  enablePackBrowser,
  getPack,
  packBrowserDir,
  packRenderDir,
  packsHome,
  PackSourceError,
  syncPack,
  updatePack,
} from '../sources.js';

// args: --pack-root R --pack-state-root S, or --pack-browser R --pack-browser-cache C
const SETUP = (browserBody: string): string =>
  [
    '#!/usr/bin/env bash',
    'set -e',
    'case "$1" in',
    '  --pack-root)',
    '    mkdir -p "$2" "$4"',
    '    printf \'{"packMode":1,"stateRoot":"%s","version":"0.0.0"}\\n\' "$4" > "$2/.gstack-pack.json"',
    '    printf \'%s\\n\' "$4" > "$2/.gstack-pack-state-root" ;;',
    '  --pack-browser)',
    browserBody,
    '    ;;',
    'esac',
  ].join('\n');
const GOOD_BROWSER = [
  '    mkdir -p "$2/node_modules/playwright" "$4/playwright" "$4/bun-cache"',
  '    printf \'%s/playwright\\n\' "$4" > "$2/.gstack-pack-browsers-path"',
  '    printf \'{"packBrowser":1,"browsersPath":"%s/playwright","version":"0.0.0"}\\n\' "$4" > "$2/.gstack-pack-browser.json"',
].join('\n');
const FAILING_BROWSER = '    echo "pack browser: boom" >&2; exit 1';

const skillMd = (name: string): string => `---\nname: ${name}\ndescription: ${name}.\n---\n`;

/** A local bare repo on branch main, pushed to from a scratch working copy. */
function createUpstream() {
  const scratch = mkdtempSync(join(tmpdir(), 'skill-pack-browser-upstream-'));
  const work = join(scratch, 'work');
  const url = join(scratch, 'upstream.git');
  const run = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: work, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', url]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  run('remote', 'add', 'origin', url);
  const commitFile = (path: string, content: string, message: string): string => {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), content);
    run('add', '-A');
    run('commit', '-q', '-m', message);
    run('push', '-q', 'origin', 'main');
    return run('rev-parse', 'HEAD');
  };
  return { scratch, url, commitFile };
}

let up: ReturnType<typeof createUpstream>;
let good = '';
let browserFails = '';
let goodAgain = '';
let noBrowser = '';
const accept = vi.fn(async () => true);
const decline = vi.fn(async () => false);

beforeAll(() => {
  up = createUpstream();
  up.commitFile('pack-mode.json', '{"packMode": 1, "packBrowser": 1}\n', 'pack mode');
  up.commitFile('package.json', JSON.stringify({ dependencies: { playwright: '^1.62.1', diff: '^9.0.0' } }), 'deps');
  up.commitFile('review/SKILL.md', skillMd('review'), 'review');
  up.commitFile('qa/SKILL.md', skillMd('qa'), 'qa');
  good = up.commitFile('setup', SETUP(GOOD_BROWSER), 'good setup');
  browserFails = up.commitFile('setup', SETUP(FAILING_BROWSER), 'failing browser step');
  goodAgain = up.commitFile('setup', SETUP(GOOD_BROWSER), 'good setup again');
  noBrowser = up.commitFile('pack-mode.json', '{"packMode": 1}\n', 'no browser step');
});

afterAll(() => {
  rmSync(up.scratch, { recursive: true, force: true });
  rmSync(overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(getGlobalConfigPath(), { force: true });
  rmSync(packsHome(), { recursive: true, force: true });
  accept.mockClear();
  decline.mockClear();
});

async function addAt(commit: string): Promise<void> {
  expect((await addPack({ id: 'gstack', url: up.url, ref: commit }, async () => true)).written).toBe(true);
}

const browserMarker = (commit: string): string => join(packRenderDir('gstack', commit), '.gstack-pack-browser.json');

describe('enablePackBrowser', () => {
  it('previews the build and writes and builds nothing when declined', async () => {
    await addAt(good);
    const result = await enablePackBrowser('gstack', decline);
    expect(result.written).toBe(false);
    expect(decline).toHaveBeenCalledOnce();
    expect(result.preview?.browser).toEqual({
      command: ['bash', 'setup', '--pack-browser', packRenderDir('gstack', good), '--pack-browser-cache', packBrowserDir('gstack')],
      downloads: [
        'diff@^9.0.0',
        'playwright@^1.62.1',
        '+ their locked dependencies from bun.lock (registry.npmjs.org)',
        'Chromium, Chromium headless shell and ffmpeg for playwright ^1.62.1 (Playwright CDN, ~115 MiB download)',
      ],
      writes: [
        `${packRenderDir('gstack', good)}/node_modules`,
        `${packRenderDir('gstack', good)}/browse/dist`,
        `${packRenderDir('gstack', good)}/design/dist`,
        `${packRenderDir('gstack', good)}/make-pdf/dist`,
        `${packBrowserDir('gstack')}/bun-cache`,
        `${packBrowserDir('gstack')}/playwright`,
        `${packBrowserDir('gstack')}/xdg-cache`,
      ],
    });
    // The preview shows the skills the runtime mounts.
    expect(result.preview?.manifest.skills.map((s) => s.name)).toEqual(['qa', 'review']);
    expect((await getPack('gstack'))?.browser).toBeUndefined();
    expect(existsSync(browserMarker(good))).toBe(false);
  });

  it('builds after consent, then records browser: true; a second enable asks nothing', async () => {
    await addAt(good);
    expect((await enablePackBrowser('gstack', accept)).written).toBe(true);
    expect(existsSync(browserMarker(good))).toBe(true);
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: good, commit: good, browser: true });

    accept.mockClear();
    expect(await enablePackBrowser('gstack', accept)).toEqual({ written: false, alreadyOn: true });
    expect(accept).not.toHaveBeenCalled();
  });

  it('a failed build is a render error and leaves the registry unchanged', async () => {
    await addAt(browserFails);
    const error = await enablePackBrowser('gstack', accept).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PackSourceError);
    expect((error as PackSourceError).code).toBe('render');
    expect((error as Error).message).toBe('pack gstack: browser build failed: pack browser: boom');
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: browserFails, commit: browserFails });
  });

  it('refuses a commit without the browser step before asking', async () => {
    await addAt(noBrowser);
    await expect(enablePackBrowser('gstack', accept)).rejects.toThrow(
      `pack gstack: ${noBrowser.slice(0, 7)} has no browser step (pack-mode.json packBrowser); update to an eltmon/gstack commit with it`,
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it('refuses an unrendered pack', async () => {
    await addAt(good);
    rmSync(packRenderDir('gstack', good), { recursive: true, force: true });
    await expect(enablePackBrowser('gstack', accept)).rejects.toThrow('pack gstack is not rendered; run pan skills pack sync gstack');
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('disablePackBrowser', () => {
  it('clears consent, renders the commit again without the runtime, and deletes the browser cache', async () => {
    await addAt(good);
    await enablePackBrowser('gstack', accept);
    expect(existsSync(join(packRenderDir('gstack', good), 'node_modules'))).toBe(true);

    expect(await disablePackBrowser('gstack')).toEqual({
      changed: true,
      renderDir: packRenderDir('gstack', good),
      cacheDir: packBrowserDir('gstack'),
    });
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: good, commit: good });
    expect(existsSync(join(packRenderDir('gstack', good), '.gstack-pack.json'))).toBe(true);
    expect(existsSync(browserMarker(good))).toBe(false);
    expect(existsSync(join(packRenderDir('gstack', good), 'node_modules'))).toBe(false);
    expect(existsSync(packBrowserDir('gstack'))).toBe(false);

    expect((await disablePackBrowser('gstack')).changed).toBe(false);
  });
});

describe('updatePack and syncPack with browser consent', () => {
  it('update adds the browser rows to the one preview, builds the new render, and moves the commit', async () => {
    await addAt(good);
    await enablePackBrowser('gstack', accept);
    accept.mockClear();
    const result = await updatePack('gstack', { ref: goodAgain }, accept);
    expect(result.written).toBe(true);
    expect(accept).toHaveBeenCalledOnce();
    expect(result.preview.browser?.command).toEqual([
      'bash', 'setup', '--pack-browser', packRenderDir('gstack', goodAgain), '--pack-browser-cache', packBrowserDir('gstack'),
    ]);
    expect(result.preview.manifest.skills.map((s) => s.name)).toEqual(['qa', 'review']);
    expect(existsSync(browserMarker(goodAgain))).toBe(true);
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: goodAgain, commit: goodAgain, browser: true });
  });

  it('a failed browser build on update leaves the trusted commit unchanged', async () => {
    await addAt(good);
    await enablePackBrowser('gstack', accept);
    const error = await updatePack('gstack', { ref: browserFails }, accept).catch((e: unknown) => e);
    expect((error as PackSourceError).code).toBe('render');
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: good, commit: good, browser: true });
  });

  it('update without consent shows and builds no browser runtime', async () => {
    await addAt(good);
    const result = await updatePack('gstack', { ref: goodAgain }, accept);
    expect(result.written).toBe(true);
    expect(result.preview.browser).toBeUndefined();
    expect(existsSync(browserMarker(goodAgain))).toBe(false);
  });

  it('sync rebuilds a missing browser runtime when consent is recorded', async () => {
    await addAt(good);
    await enablePackBrowser('gstack', accept);
    rmSync(browserMarker(good));
    await syncPack('gstack');
    expect(existsSync(browserMarker(good))).toBe(true);
  });

  it('sync without consent never runs the browser step', async () => {
    await addAt(good);
    await syncPack('gstack');
    expect(existsSync(browserMarker(good))).toBe(false);
    expect(existsSync(packBrowserDir('gstack'))).toBe(false);
  });
});
