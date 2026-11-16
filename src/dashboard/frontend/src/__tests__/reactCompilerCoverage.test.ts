/**
 * PAN-4561: React Compiler skip coverage. Every frontend source file the
 * compiler skips (a diagnostic, or a "use no memo" opt-out) must have a row in
 * scripts/react-compiler-skip-baseline.txt at or above its count, and no row
 * may be higher than the file's count. The baseline only shrinks.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  compareToBaseline,
  readBaseline,
  scanFrontend,
  skipCountForSource,
} from '../../scripts/reactCompilerCoverage';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendSrc = path.resolve(here, '..');
const repoRoot = path.resolve(frontendSrc, '../../../..');
const baselineFile = path.join(repoRoot, 'scripts', 'react-compiler-skip-baseline.txt');

const BAD = `import { useState } from 'react';
declare function post(p: string): Promise<void>;
export function Banner({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await post(path); } finally { setBusy(false); }
  };
  return <button disabled={busy} onClick={run}>go</button>;
}
`;

const GOOD = `import { useState } from 'react';
declare function post(p: string): Promise<void>;
export function Banner({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    post(path).finally(() => setBusy(false));
  };
  return <button disabled={busy} onClick={run}>go</button>;
}
`;

const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'rc-cov-'));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('React Compiler skip coverage', () => {
  it('reports a component the compiler skips and not one it compiles', () => {
    writeFileSync(path.join(fixtureDir, 'Bad.tsx'), BAD);
    writeFileSync(path.join(fixtureDir, 'Good.tsx'), GOOD);
    const entries = [...scanFrontend(fixtureDir)];
    const bad = entries.find(([p]) => p.endsWith('/Bad.tsx'));
    expect(bad?.[1].count).toBeGreaterThanOrEqual(1);
    expect(entries.some(([p]) => p.endsWith('/Good.tsx'))).toBe(false);
  });

  it('counts a "use no memo" directive as a skip', () => {
    expect(skipCountForSource('C.tsx', 'export function C() {\n  "use no memo";\n  return null;\n}').count).toBe(1);
  });

  it('the frontend tree matches scripts/react-compiler-skip-baseline.txt', () => {
    const current = scanFrontend(frontendSrc);
    const baseline = readBaseline(baselineFile);
    const result = compareToBaseline(current, baseline);
    const describeRow = (p: string) => {
      const skip = current.get(p);
      return `  ${p}: ${skip?.count ?? 0} skip(s), baseline ${baseline.get(p) ?? 'none'}${skip?.firstMessage ? ` (${skip.firstMessage})` : ''}`;
    };
    const lines = [...result.added, ...result.raised, ...result.stale].map(describeRow);
    const message = [
      'React Compiler skip baseline mismatch:',
      ...lines,
      'A new skip: fix the component (docs/DASHBOARD-ARCHITECTURE.md, React Compiler). A stale row: run npx tsx src/dashboard/frontend/scripts/reactCompilerCoverage.ts --update.',
    ].join('\n');
    expect(result, message).toEqual({ added: [], raised: [], stale: [] });
  });
});
