/**
 * PAN-4727 WI-O3: the gstack render runner, against a fixture extraction whose
 * `setup` is a fake bash script (no real gstack, no bun install, no network).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRenderable, gcPackRenders, isRenderReady, RenderError, renderCommand, renderRuntimePack } from '../render.js';

const COMMIT = 'b'.repeat(40);
const dirs: string[] = [];

type SetupVariant = 'ok' | 'exit3' | 'no-marker';

const SETUP_BODY: Record<SetupVariant, string> = {
  ok: [
    'mkdir -p "$2" "$4"',
    'printf \'{"packMode":1,"stateRoot":"%s","version":"0.0.0"}\\n\' "$4" > "$2/.gstack-pack.json"',
    'printf \'%s\\n\' "$4" > "$2/.gstack-pack-state-root"',
  ].join('\n'),
  exit3: ['mkdir -p "$2"', 'echo partial > "$2/partial"', 'echo "pack mode: boom" >&2', 'exit 3'].join('\n'),
  'no-marker': ['mkdir -p "$2"', 'echo partial > "$2/partial"'].join('\n'),
};

/** A temp root holding an extraction with `pack-mode.json` (unless omitted) and a fake `setup`. */
function fixture(variant: SetupVariant, opts: { packMode?: string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skill-pack-render-'));
  dirs.push(root);
  const extractDir = join(root, 'extract');
  mkdirSync(extractDir);
  const sentinel = join(root, 'setup-ran');
  writeFileSync(
    join(extractDir, 'setup'),
    `#!/usr/bin/env bash\nset -e\ntouch "${sentinel}"\n# args: --pack-root R --pack-state-root S\n${SETUP_BODY[variant]}\n`,
  );
  const packMode = opts.packMode === undefined ? '{"packMode": 1}\n' : opts.packMode;
  if (packMode !== null) writeFileSync(join(extractDir, 'pack-mode.json'), packMode);
  return {
    extractDir,
    sentinel,
    renderDir: join(root, 'packs', 'gstack', 'render', COMMIT),
    stateDir: join(root, 'packs', 'gstack', 'state'),
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('renderCommand', () => {
  it('is the fork pack-mode invocation', () => {
    expect(renderCommand('/r', '/s')).toEqual(['bash', 'setup', '--pack-root', '/r', '--pack-state-root', '/s']);
  });
});

describe('renderRuntimePack', () => {
  it('renders into the render dir and creates the state dir', async () => {
    const f = fixture('ok');
    await renderRuntimePack({ ...f, commit: COMMIT });
    expect(await isRenderReady(f.renderDir)).toBe(true);
    expect(readFileSync(join(f.renderDir, '.gstack-pack-state-root'), 'utf8').trim()).toBe(f.stateDir);
    expect(existsSync(f.stateDir)).toBe(true);
  });

  it('replaces an earlier partial render', async () => {
    const f = fixture('ok');
    mkdirSync(f.renderDir, { recursive: true });
    writeFileSync(join(f.renderDir, 'stale'), 'x');
    await renderRuntimePack({ ...f, commit: COMMIT });
    expect(existsSync(join(f.renderDir, 'stale'))).toBe(false);
    expect(await isRenderReady(f.renderDir)).toBe(true);
  });

  it('removes the render dir and reports the stderr tail when setup fails', async () => {
    const f = fixture('exit3');
    const error = await renderRuntimePack({ ...f, commit: COMMIT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe('pack gstack: render failed: pack mode: boom');
    expect(existsSync(f.renderDir)).toBe(false);
  });

  it('removes the render dir when setup succeeds without the ready marker', async () => {
    const f = fixture('no-marker');
    await expect(renderRuntimePack({ ...f, commit: COMMIT })).rejects.toThrow('pack gstack: render wrote no .gstack-pack.json');
    expect(existsSync(f.renderDir)).toBe(false);
  });
});

describe('assertRenderable', () => {
  it('rejects a commit without pack mode before setup runs', async () => {
    for (const packMode of [null, 'not json', '{"packMode": 2}']) {
      const f = fixture('ok', { packMode });
      const error = await renderRuntimePack({ ...f, commit: COMMIT }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RenderError);
      expect((error as Error).message).toBe(
        'pack gstack: bbbbbbb has no pack mode (pack-mode.json); use https://github.com/eltmon/gstack at a commit with pack mode',
      );
      expect(existsSync(f.sentinel)).toBe(false);
      expect(existsSync(f.renderDir)).toBe(false);
    }
  });

  it('requires bun on PATH', async () => {
    const f = fixture('ok');
    const bin = mkdtempSync(join(tmpdir(), 'skill-pack-render-path-'));
    dirs.push(bin);
    symlinkSync('/bin/bash', join(bin, 'bash'));
    const path = process.env['PATH'];
    process.env['PATH'] = bin;
    try {
      await expect(assertRenderable(f.extractDir, COMMIT)).rejects.toThrow('pack gstack needs bun on PATH (https://bun.sh)');
    } finally {
      process.env['PATH'] = path;
    }
  });
});

describe('isRenderReady', () => {
  it('is false without the marker, with a bad marker, or with another packMode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pack-render-ready-'));
    dirs.push(root);
    expect(await isRenderReady(join(root, 'missing'))).toBe(false);
    writeFileSync(join(root, '.gstack-pack.json'), '{');
    expect(await isRenderReady(root)).toBe(false);
    writeFileSync(join(root, '.gstack-pack.json'), '{"packMode":2}');
    expect(await isRenderReady(root)).toBe(false);
    writeFileSync(join(root, '.gstack-pack.json'), '{"packMode":1}');
    expect(await isRenderReady(root)).toBe(true);
  });
});

describe('gcPackRenders', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-11-01T12:00:00Z');
  const OLD = 'c'.repeat(40);
  const YOUNG = 'd'.repeat(40);
  const base = { maxAgeMs: 7 * DAY, now, registryReadable: true };

  function home() {
    const packsHome = mkdtempSync(join(tmpdir(), 'skill-pack-render-gc-'));
    dirs.push(packsHome);
    const age = (dir: string, ageDays: number) => {
      const when = new Date(now - ageDays * DAY);
      utimesSync(dir, when, when);
      return dir;
    };
    const make = (path: string, ageDays: number) => {
      const dir = join(packsHome, path);
      mkdirSync(dir, { recursive: true });
      return age(dir, ageDays);
    };
    /** An unregistered id's render/ and state/, each holding one child, all aged together. */
    const orphan = (id: string, ageDays: number) => {
      make(`${id}/render/${COMMIT}`, ageDays);
      make(`${id}/state/sessions`, ageDays);
      return { render: age(join(packsHome, id, 'render'), ageDays), state: age(join(packsHome, id, 'state'), ageDays) };
    };
    return { packsHome, make, orphan };
  }

  it('keeps the trusted render at any age, removes old non-trusted renders, and keeps young ones', async () => {
    const { packsHome, make } = home();
    const trusted = make(`gstack/render/${COMMIT}`, 90);
    const old = make(`gstack/render/${OLD}`, 30);
    const young = make(`gstack/render/${YOUNG}`, 1);
    const state = make('gstack/state', 90);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map([['gstack', COMMIT]]) });
    expect(result).toEqual({ removedRenders: [old], removedStates: [] });
    expect([existsSync(trusted), existsSync(old), existsSync(young), existsSync(state)]).toEqual([true, false, true, true]);
  });

  it('keeps an old non-trusted render that a linked mount still calls into', async () => {
    const { packsHome, make } = home();
    const inUse = make(`gstack/render/${OLD}`, 30);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map([['gstack', COMMIT]]), keep: new Set([inUse]) });
    expect(result).toEqual({ removedRenders: [], removedStates: [] });
    expect(existsSync(inUse)).toBe(true);
  });

  it('removes old render and state of an unregistered id and leaves its other files and mounts alone', async () => {
    const { packsHome, make, orphan } = home();
    const dirsOf = orphan('gstack', 30);
    const extraction = make(`gstack/${COMMIT}`, 30);
    const mounts = make('mounts/abc', 90);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map() });
    expect(result).toEqual({ removedRenders: [dirsOf.render], removedStates: [dirsOf.state] });
    expect(existsSync(extraction)).toBe(true);
    expect(existsSync(mounts)).toBe(true);
  });

  it('removes an old unregistered id\'s browser runtime dir with its render and state (PAN-4730)', async () => {
    const { packsHome, make, orphan } = home();
    const dirsOf = orphan('gstack', 30);
    make('gstack/browser/playwright', 30);
    const browser = make('gstack/browser', 30);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map() });
    expect(result).toEqual({ removedRenders: [dirsOf.render], removedStates: [dirsOf.state, browser] });
    expect(existsSync(browser)).toBe(false);
  });

  it('keeps an unregistered id whose browser dir is young', async () => {
    const { packsHome, make, orphan } = home();
    const dirsOf = orphan('gstack', 30);
    const browser = make('gstack/browser', 0);
    expect(await gcPackRenders({ ...base, packsHome, registered: new Map() })).toEqual({ removedRenders: [], removedStates: [] });
    expect([existsSync(dirsOf.render), existsSync(browser)]).toEqual([true, true]);
  });

  it('keeps an unregistered id whose render or state is young, as an add still rendering has', async () => {
    const { packsHome, orphan } = home();
    const dirsOf = orphan('gstack', 0);
    expect(await gcPackRenders({ ...base, packsHome, registered: new Map() })).toEqual({ removedRenders: [], removedStates: [] });
    expect([existsSync(dirsOf.render), existsSync(dirsOf.state)]).toEqual([true, true]);
  });

  it('removes no orphan when the registry could not be read', async () => {
    const { packsHome, orphan } = home();
    const dirsOf = orphan('gstack', 90);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map(), registryReadable: false });
    expect(result).toEqual({ removedRenders: [], removedStates: [] });
    expect([existsSync(dirsOf.render), existsSync(dirsOf.state)]).toEqual([true, true]);
  });

  it('touches nothing of a registered id whose entry is malformed', async () => {
    const { packsHome, make, orphan } = home();
    const dirsOf = orphan('gstack', 90);
    const old = make(`gstack/render/${OLD}`, 90);
    const result = await gcPackRenders({ ...base, packsHome, registered: new Map([['gstack', null]]) });
    expect(result).toEqual({ removedRenders: [], removedStates: [] });
    expect([existsSync(dirsOf.state), existsSync(old)]).toEqual([true, true]);
  });

  it('does nothing when the packs home does not exist', async () => {
    const result = await gcPackRenders({ ...base, packsHome: join(tmpdir(), 'no-such-packs-home-pan-4727'), registered: new Map(), maxAgeMs: 0 });
    expect(result).toEqual({ removedRenders: [], removedStates: [] });
  });
});
