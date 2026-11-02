/**
 * PAN-4644: the /api/color-themes routes — list+selection read, selection
 * write, VS Code import preview (writes nothing), and save.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

// config-yaml/load.js's GLOBAL_CONFIG_PATH is captured once at first import
// from OVERDECK_HOME (unlike store.ts's dynamic getOverdeckHome()), so
// OVERDECK_HOME must be set to its final value before colorThemesRouteLayer
// (which reaches it via selection.ts/selection-write.ts) is first imported.
// One fixed home for the whole file; each test clears its own contents.
const originalHome = process.env.OVERDECK_HOME;
const home = await mkdtemp(join(tmpdir(), 'pan-4644-color-themes-'));
process.env.OVERDECK_HOME = home;

const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { colorThemesRouteLayer } = await import('../routes/color-themes.js');
const { buildVsix } = await import('../../../lib/color-themes/__tests__/zip-fixture.js');

const INTERNAL_TOKEN = 'color-themes-internal-token-0123456789';
const asInternal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };

async function call(method: 'GET' | 'POST' | 'PUT', path: string, headers: Record<string, string>, body?: unknown) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(colorThemesRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, text, json: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('GET /api/color-themes', () => {
  it('lists the built-ins with the built-in selection when nothing is configured', async () => {
    const res = await call('GET', '/api/color-themes', {});
    expect(res.status).toBe(200);
    expect(res.json.themes.map((t: { id: string }) => t.id)).toEqual(['overdeck-dark', 'overdeck-light']);
    expect(res.json.selection).toEqual({ light: 'overdeck-light', dark: 'overdeck-dark' });
    expect(res.json.warnings).toEqual([]);
  });
});

describe('POST /api/color-themes/import/preview (PAN-4644 ac1, ac4)', () => {
  it('returns the mapped theme with a proposed id and writes nothing', async () => {
    const fixturePath = join(__dirname, '..', '..', '..', 'lib', 'color-themes', '__tests__', 'fixtures', 'ayu-dark.jsonc');
    const text = await readFile(fixturePath, 'utf8');
    const res = await call('POST', '/api/color-themes/import/preview', asInternal, {
      fileName: 'ayu-dark.json',
      contentBase64: Buffer.from(text, 'utf8').toString('base64'),
    });

    expect(res.status).toBe(200);
    expect(res.json.themes).toHaveLength(1);
    expect(res.json.themes[0].id).toBe('ayu-dark');
    expect(res.json.themes[0].terminal.background).toBe('#0d1017');

    await expect(readdir(join(home, 'themes')).catch(() => [])).resolves.toEqual([]);
  });

  it('rejects a file name that is neither .json nor .vsix with 400', async () => {
    const res = await call('POST', '/api/color-themes/import/preview', asInternal, {
      fileName: 'theme.txt',
      contentBase64: Buffer.from('{}', 'utf8').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('.vsix');
  });

  it('rejects a payload over the 2 MB import limit with 413', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 'a').toString('base64');
    const res = await call('POST', '/api/color-themes/import/preview', asInternal, {
      fileName: 'big.json',
      contentBase64: big,
    });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/color-themes/import/preview with a .vsix (PAN-4659)', () => {
  function twoThemeVsix(): Buffer {
    return buildVsix({
      'extension/package.json': JSON.stringify({
        name: 'route-pack',
        contributes: {
          themes: [
            { label: 'Route Light', uiTheme: 'vs', path: './themes/light.json' },
            { label: 'Route Dark', uiTheme: 'vs-dark', path: './themes/dark.json' },
          ],
        },
      }),
      'extension/themes/light.json': JSON.stringify({ colors: { 'editor.background': '#fafafa' }, tokenColors: [] }),
      'extension/themes/dark.json': JSON.stringify({ include: './base.json', colors: { 'editor.background': '#1e1e1e' } }),
      'extension/themes/base.json': JSON.stringify({ colors: { 'terminal.ansiRed': '#ff5555' }, tokenColors: [] }),
    });
  }

  async function previewVsix(fileName: string, archive: Buffer) {
    return call('POST', '/api/color-themes/import/preview', asInternal, {
      fileName,
      contentBase64: archive.toString('base64'),
    });
  }

  async function themeFiles(): Promise<string[]> {
    return readdir(join(home, 'themes')).catch(() => []);
  }

  it('previews both themes without writing, and saving them lists one light and one dark theme', async () => {
    const res = await previewVsix('route-pack-1.0.0.vsix', twoThemeVsix());

    expect(res.status).toBe(200);
    expect(res.json.themes.map((t: { id: string; type: string }) => [t.id, t.type])).toEqual([
      ['route-light', 'light'],
      ['route-dark', 'dark'],
    ]);
    expect(res.json.themes[1].terminal.red).toBe('#ff5555');
    await expect(themeFiles()).resolves.toEqual([]);

    for (const theme of res.json.themes) {
      const saved = await call('POST', '/api/color-themes', asInternal, { theme });
      expect(saved.status).toBe(200);
    }
    const list = await call('GET', '/api/color-themes', {});
    const imported = list.json.themes.filter((t: { builtin: boolean }) => !t.builtin);
    expect(imported.map((t: { name: string; type: string }) => [t.name, t.type])).toEqual(
      expect.arrayContaining([['Route Light', 'light'], ['Route Dark', 'dark']]),
    );
    expect(imported).toHaveLength(2);
  });

  it('rejects an archive over 10 MB with 400 and writes nothing', async () => {
    const res = await previewVsix('big.vsix', Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('10 MB');
    await expect(themeFiles()).resolves.toEqual([]);
  });

  it('rejects a ZIP64 archive with 400 and writes nothing', async () => {
    const res = await previewVsix('zip64.vsix', buildVsix({ 'extension/package.json': '{}' }, { zip64: true }));
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('ZIP64');
    await expect(themeFiles()).resolves.toEqual([]);
  });

  it('rejects an archive with a .. entry path with 400 and writes nothing', async () => {
    const archive = buildVsix({ 'extension/package.json': '{}', 'extension/../evil.json': '{}' });
    const res = await previewVsix('evil.vsix', archive);
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('..');
    await expect(themeFiles()).resolves.toEqual([]);
  });
});

describe('POST /api/color-themes (PAN-4644 ac2)', () => {
  it('saves a file under <OVERDECK_HOME>/themes/ and a following GET lists it', async () => {
    const saveRes = await call('POST', '/api/color-themes', asInternal, {
      theme: { name: 'Ayu Dark', type: 'dark' },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.json.theme.id).toBe('ayu-dark');

    const files = await readdir(join(home, 'themes'));
    expect(files).toEqual(['ayu-dark.json']);

    const listRes = await call('GET', '/api/color-themes', {});
    expect(listRes.json.themes.map((t: { id: string }) => t.id)).toContain('ayu-dark');
  });

  it('answers 400 with errors on validation failure', async () => {
    const res = await call('POST', '/api/color-themes', asInternal, { theme: { name: 'No Type' } });
    expect(res.status).toBe(400);
    expect(res.json.errors.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/color-themes/selection (PAN-4644 ac3)', () => {
  it('answers 400 when the id names the wrong type for the mode', async () => {
    await writeFile(join(await mkThemesDir(), 'ayu-light.json'), JSON.stringify({ name: 'Ayu Light', type: 'light' }), 'utf8');
    const res = await call('PUT', '/api/color-themes/selection', asInternal, { mode: 'dark', id: 'ayu-light' });
    expect(res.status).toBe(400);
  });

  it('persists ui.color_theme.dark for a dark theme id', async () => {
    await writeFile(join(await mkThemesDir(), 'ayu-dark.json'), JSON.stringify({ name: 'Ayu Dark', type: 'dark' }), 'utf8');
    const res = await call('PUT', '/api/color-themes/selection', asInternal, { mode: 'dark', id: 'ayu-dark' });
    expect(res.status).toBe(200);
    expect(res.json.selection.dark).toBe('ayu-dark');

    const configText = await readFile(join(home, 'config.yaml'), 'utf8');
    expect(configText).toContain('ayu-dark');
  });

  async function mkThemesDir(): Promise<string> {
    const dir = join(home, 'themes');
    await mkdir(dir, { recursive: true });
    return dir;
  }
});

describe('PUT /api/color-themes/:id (PAN-4660)', () => {
  it('answers 403 for a built-in id and writes nothing', async () => {
    const res = await call('PUT', '/api/color-themes/overdeck-dark', asInternal, {
      theme: { name: 'Custom', type: 'dark' },
    });
    expect(res.status).toBe(403);

    const files = await readdir(join(home, 'themes')).catch(() => []);
    expect(files).not.toContain('overdeck-dark.json');
  });

  it('answers 404 for an id with no user theme file', async () => {
    const res = await call('PUT', '/api/color-themes/nope', asInternal, {
      theme: { name: 'Custom', type: 'dark' },
    });
    expect(res.status).toBe(404);
  });

  it('round trip: duplicate a built-in, then overwrite it in place', async () => {
    const saveRes = await call('POST', '/api/color-themes', asInternal, {
      theme: { name: 'Overdeck Dark copy', type: 'dark', terminal: { background: '#1a1a2e' } },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.json.theme.id).toBe('overdeck-dark-copy');

    const putRes = await call('PUT', '/api/color-themes/overdeck-dark-copy', asInternal, {
      theme: { name: 'Overdeck Dark copy', type: 'dark', terminal: { background: '#000000' } },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.json.theme.terminal.background).toBe('#000000');

    const listRes = await call('GET', '/api/color-themes', {});
    const matches = listRes.json.themes.filter((t: { id: string }) => t.id === 'overdeck-dark-copy');
    expect(matches).toHaveLength(1);
    expect(matches[0].terminal.background).toBe('#000000');
  });

  it('rejects an unauthenticated request and leaves the existing file unchanged', async () => {
    const themesDir = await mkThemesDir();
    const original = JSON.stringify({ name: 'Ayu Dark', type: 'dark' });
    await writeFile(join(themesDir, 'ayu-dark.json'), original, 'utf8');

    const res = await call('PUT', '/api/color-themes/ayu-dark', {}, {
      theme: { name: 'Ayu Dark', type: 'dark', terminal: { background: '#000000' } },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const onDisk = await readFile(join(themesDir, 'ayu-dark.json'), 'utf8');
    expect(onDisk).toBe(original);
  });

  it('the static /api/color-themes/selection route still wins over the :id route', async () => {
    const res = await call('PUT', '/api/color-themes/selection', asInternal, { mode: 'dark', id: 'overdeck-dark' });
    expect(res.status).toBe(200);
    expect(res.json.selection).toEqual({ light: 'overdeck-light', dark: 'overdeck-dark' });
  });

  async function mkThemesDir(): Promise<string> {
    const dir = join(home, 'themes');
    await mkdir(dir, { recursive: true });
    return dir;
  }
});
