import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/audit-effect-boundary.mjs', import.meta.url));

const FIXTURE_MODULE = `import { Effect } from 'effect';
import { helper } from './helper.js';

async function fooPromise(): Promise<number> {
  return 1;
}
async function barPromise(): Promise<number> {
  return 2;
}
function bazSync(): number {
  return 3;
}

/** Shape A via Effect.promise. */
export const foo = (): Effect.Effect<number> => Effect.promise(() => fooPromise());

/** Shape A via multi-line Effect.tryPromise. */
export const bar = (): Effect.Effect<number, Error> =>
  Effect.tryPromise({
    try: () => barPromise(),
    catch: (cause) => new Error(String(cause)),
  });

/** Shape B via Effect.sync. */
export const baz = (): Effect.Effect<number> => Effect.sync(() => bazSync());

/** Shape C: two independent implementations of one operation. */
export function quxSync(): number {
  return helper();
}
export const qux = (): Effect.Effect<number, Error> =>
  Effect.tryPromise({
    try: async () => {
      await Promise.resolve();
      return helper();
    },
    catch: (cause) => new Error(String(cause)),
  });

/** Genuine Effect body: not a façade. */
export const gen = (): Effect.Effect<number> =>
  Effect.gen(function* () {
    const a = yield* foo();
    return a + 1;
  });

/** Dynamic import is not an in-repo call: not a façade. */
export const lazy = () => Effect.promise(() => import('./helper.js'));
`;

const TEST_FILE_WITH_FACADE = `import { Effect } from 'effect';
async function hiddenPromise(): Promise<number> {
  return 1;
}
export const hidden = () => Effect.promise(() => hiddenPromise());
`;

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'audit-effect-boundary-'));
  mkdirSync(join(root, 'src', 'lib', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'src', 'lib', 'a.ts'), FIXTURE_MODULE);
  writeFileSync(join(root, 'src', 'lib', 'helper.ts'), 'export function helper(): number {\n  return 4;\n}\n');
  writeFileSync(join(root, 'src', 'lib', '__tests__', 'a.test.ts'), TEST_FILE_WITH_FACADE);
  writeFileSync(join(root, 'src', 'lib', 'b.spec.ts'), TEST_FILE_WITH_FACADE);
  return root;
}

function runAudit(args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
}

describe('audit-effect-boundary.mjs', () => {
  it('prints exactly one baseline row per shape, excluding dynamic import and test files', () => {
    const root = makeFixture();

    const output = runAudit(['--root', root, '--baseline']);

    expect(output).toBe('A 2 src/lib/a.ts\nB 1 src/lib/a.ts\nC 1 src/lib/a.ts\n');
  });

  it('names each façade and the twin pair in --json output', () => {
    const root = makeFixture();

    const result = JSON.parse(runAudit(['--root', root, '--json'])) as {
      totals: Record<string, number>;
      facades: Array<{ name: string; shape: string; callee: string }>;
      twinPairs: Array<{ base: string; twin: string; shapeC: boolean }>;
    };

    expect(result.totals).toEqual({ A: 2, B: 1, C: 1 });
    expect(result.facades.map((f) => `${f.shape} ${f.name} -> ${f.callee}`).sort()).toEqual([
      'A bar -> barPromise',
      'A foo -> fooPromise',
      'B baz -> bazSync',
    ]);
    expect(result.twinPairs).toEqual([expect.objectContaining({ base: 'qux', twin: 'quxSync', shapeC: true })]);
  });

  it('prints nothing for a tree without façades', () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-effect-boundary-empty-'));
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'lib', 'plain.ts'), 'export async function plain(): Promise<void> {}\n');

    expect(runAudit(['--root', root, '--baseline'])).toBe('');
  });
});
