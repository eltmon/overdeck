/**
 * G3 gate — no-loss matrix completeness test.
 *
 * AC1: Every HTTP endpoint and RPC method in the current codebase has an entry
 *      in NO_LOSS_MATRIX with a non-empty door/reason.
 * AC2: The test fails when a new endpoint or RPC method is added but not added
 *      to the matrix (surface-locked invariant).
 * AC3: DELETE and OUT_OF_SCOPE entries carry a non-empty reason string — no
 *      silent drops.
 *
 * CLI verbs are validated for structural integrity (non-empty door) but are not
 * dynamically enumerated (no stable machine-readable manifest of pan commands).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { NO_LOSS_MATRIX, type MatrixEntry } from './no-loss-matrix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');
const ROUTES_DIR = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes');
const RPC_FILE   = join(WORKSPACE_ROOT, 'packages', 'contracts', 'src', 'rpc.ts');

// ── Route enumeration ─────────────────────────────────────────────────────────
//
// Two patterns capture the two registration styles used in route files:
//   Pattern 1: HttpRouter.add(\n  'METHOD', '/path'  — inline multi-line
//   Pattern 2: helperFn('METHOD', '/api/path'         — helper with method+path

function enumerateHttpRoutes(): Set<string> {
  const routes = new Set<string>();
  const files = readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const content = readFileSync(join(ROUTES_DIR, file), 'utf8');

    // Pattern 1: HttpRouter.add( ... 'METHOD', ... '/path'
    const p1 = /HttpRouter\.add\(\s*\n?\s*['"`]([A-Z]+)['"`]\s*,\s*\n?\s*['"`]([^'"`\n]+)['"`]/gm;
    for (const m of content.matchAll(p1)) {
      routes.add(`${m[1]} ${m[2]}`);
    }

    // Pattern 2: helperFn('METHOD', '/api/...' or '/events/...' or '/a/...')
    const p2 = /\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`](\/(?:api|events|a)\/[^'"`\n]+)['"`]/gm;
    for (const m of content.matchAll(p2)) {
      routes.add(`${m[1]} ${m[2]}`);
    }
  }

  return routes;
}

// ── RPC method enumeration ────────────────────────────────────────────────────

function enumerateRpcMethods(): Set<string> {
  const content = readFileSync(RPC_FILE, 'utf8');
  const methods = new Set<string>();

  // Match:  someKey: "pan.methodName",
  const re = /['"`]?[\w]+['"`]?\s*:\s*['"`](pan\.[a-zA-Z]+)['"`]/g;
  for (const m of content.matchAll(re)) {
    methods.add(m[1]);
  }
  return methods;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matrixSurfaces(kind: MatrixEntry['kind']): Set<string> {
  return new Set(NO_LOSS_MATRIX.filter(e => e.kind === kind).map(e => e.surface));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('G3 no-loss matrix', () => {
  it('AC1/AC2: every enumerated HTTP route is present in the matrix', () => {
    const live    = enumerateHttpRoutes();
    const inMatrix = matrixSurfaces('http');
    const missing: string[] = [];

    for (const route of live) {
      if (!inMatrix.has(route)) {
        missing.push(route);
      }
    }

    expect(missing, [
      'The following HTTP routes exist in the codebase but have no entry in the',
      'NO_LOSS_MATRIX.  Add each one to tests/unit/lib/overdeck/no-loss-matrix.ts',
      'with an explicit disposition (READ/WRITE/AGGREGATE/RELOCATE/DELETE/OUT_OF_SCOPE)',
      'and a non-empty door/reason string.',
      ...missing.map(r => `  missing: ${r}`),
    ].join('\n')).toEqual([]);
  });

  it('AC1/AC2: every enumerated RPC method is present in the matrix', () => {
    const live     = enumerateRpcMethods();
    const inMatrix = matrixSurfaces('rpc');
    const missing: string[] = [];

    for (const method of live) {
      if (!inMatrix.has(method)) {
        missing.push(method);
      }
    }

    expect(missing, [
      'The following RPC methods exist in packages/contracts/src/rpc.ts but',
      'have no entry in the NO_LOSS_MATRIX.  Add each one to',
      'tests/unit/lib/overdeck/no-loss-matrix.ts.',
      ...missing.map(m => `  missing: ${m}`),
    ].join('\n')).toEqual([]);
  });

  it('AC1: every matrix entry has a non-empty door/reason', () => {
    const empty = NO_LOSS_MATRIX.filter(e => !e.door || e.door.trim() === '');
    expect(empty.map(e => e.surface), [
      'The following matrix entries have an empty door/reason string.',
      'Fill in the door name (for READ/WRITE/AGGREGATE/RELOCATE) or',
      'the drop reason (for DELETE/OUT_OF_SCOPE).',
    ].join('\n')).toEqual([]);
  });

  it('AC3: DELETE and OUT_OF_SCOPE entries carry a non-empty reason (named decisions only)', () => {
    const bad = NO_LOSS_MATRIX.filter(
      e => (e.disposition === 'DELETE' || e.disposition === 'OUT_OF_SCOPE') &&
           (!e.door || e.door.trim() === ''),
    );
    expect(bad.map(e => e.surface), [
      'DELETE and OUT_OF_SCOPE entries must carry a non-empty reason in the door field.',
      'Silent drops are not allowed — document WHY the surface is gone or out-of-scope.',
    ].join('\n')).toEqual([]);
  });

  it('matrix has no duplicate surface entries', () => {
    const seen = new Map<string, number>();
    for (const e of NO_LOSS_MATRIX) {
      seen.set(e.surface, (seen.get(e.surface) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    expect(dupes, 'Duplicate surface keys found in NO_LOSS_MATRIX').toEqual([]);
  });
});
