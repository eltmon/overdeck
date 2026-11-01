/**
 * PAN-4727 WI-O3: the gstack render runner, against a fixture extraction whose
 * `setup` is a fake bash script (no real gstack, no bun install, no network).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRenderable, isRenderReady, RenderError, renderCommand, renderRuntimePack } from '../render.js';

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
