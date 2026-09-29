import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lineHash } from '../../../../src/lib/vault/continuity.js';
import { allowSecret, scanWipPatch } from '../../../../src/lib/vault/secrets.js';

const TOKEN = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
const ADDED = `const token = '${TOKEN}';`;

function patch(body: string[], file = 'src/a.ts'): string {
  return [
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    '',
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,2 +1,2 @@',
    ...body,
    '',
  ].join('\n');
}

describe('scanWipPatch', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-wip-scan-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac1: reports an added token with its file and pattern', async () => {
    const hits = await scanWipPatch('vault-a', patch([' unchanged', `+${ADDED}`, '-old line']));
    expect(hits).toEqual([{ file: 'src/a.ts', pattern: 'token', hash: lineHash(ADDED) }]);
  });

  it('ac2: ignores the token on a removed or context line', async () => {
    expect(await scanWipPatch('vault-a', patch([`-${ADDED}`, '+clean line']))).toEqual([]);
    expect(await scanWipPatch('vault-a', patch([` ${ADDED}`, '+clean line']))).toEqual([]);
  });

  it('ac3: an allowed hash no longer blocks', async () => {
    const [hit] = await scanWipPatch('vault-a', patch([`+${ADDED}`]));
    await allowSecret('vault-a', hit!.hash);
    expect(await scanWipPatch('vault-a', patch([`+${ADDED}`]))).toEqual([]);
    expect(await scanWipPatch('vault-b', patch([`+${ADDED}`]))).toHaveLength(1);
  });

  it('ac4: never includes the token text in the result', async () => {
    const serialized = JSON.stringify(await scanWipPatch('vault-a', patch([`+${ADDED}`])));
    for (let len = 8; len <= TOKEN.length; len++) {
      for (let i = 0; i + len <= TOKEN.length; i++) {
        expect(serialized.includes(TOKEN.slice(i, i + len))).toBe(false);
      }
    }
  });

  it('names the new file of an added file and the old file of a deleted one', async () => {
    const added = [
      'diff --git a/new.env b/new.env',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.env',
      '@@ -0,0 +1 @@',
      `+${ADDED}`,
    ].join('\n');
    expect((await scanWipPatch('vault-a', added)).map((hit) => hit.file)).toEqual(['new.env']);
    const deleted = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      `-${ADDED}`,
    ].join('\n');
    expect(await scanWipPatch('vault-a', deleted)).toEqual([]);
  });

  it('scans an added line that itself starts with "++" and tracks files across commits', async () => {
    const twoCommits = `${patch([`+++${ADDED}`], 'first.ts')}${patch([`+${ADDED}`], 'second.ts')}`;
    expect((await scanWipPatch('vault-a', twoCommits)).map((hit) => hit.file)).toEqual(['first.ts', 'second.ts']);
  });
});
