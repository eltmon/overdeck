import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHandoffPaths, ensureHandoffsDir } from '../handoff-paths.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;

afterEach(() => {
  if (originalPanopticonHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = originalPanopticonHome;
  }
});

describe('handoff paths', () => {
  it('returns deterministic doc and sentinel paths under PANOPTICON_HOME', () => {
    const home = join(tmpdir(), `pan-handoff-paths-${Date.now()}`);
    process.env.PANOPTICON_HOME = home;

    const paths = createHandoffPaths('conv-123', '2026-05-23T04:35:00.000Z');

    expect(paths).toEqual({
      docPath: join(home, 'handoffs', 'conv-123-2026-05-23T04:35:00.000Z.md'),
      sentinelPath: join(home, 'handoffs', 'conv-123-2026-05-23T04:35:00.000Z.md.done'),
    });
    expect(existsSync(join(home, 'handoffs'))).toBe(false);
  });

  it('creates the handoffs directory only when requested', async () => {
    const home = join(tmpdir(), `pan-handoff-paths-${Date.now()}-mkdir`);
    process.env.PANOPTICON_HOME = home;

    const handoffsDir = await ensureHandoffsDir();

    expect(handoffsDir).toBe(join(home, 'handoffs'));
    expect(existsSync(handoffsDir)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  it('rejects unsafe conversation ids before building a path', () => {
    expect(() => createHandoffPaths('../outside', '2026-05-23T04:35:00.000Z')).toThrow(
      'Invalid handoff conversation id',
    );
  });
});
