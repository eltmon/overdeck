/**
 * PAN-1919: retire dead continue modules to types-only / read-only legacy.
 *
 * AC: pan-dir/continues.ts is deleted, its exports removed from pan-dir/index.ts
 * AC: continue-state.ts preserves Continue* types but defines no fs read/write function
 * AC: pan-dir/continue.ts deletes readWorkspaceContinue/writeWorkspaceContinue
 * AC: promoteContinueToProject deleted; planning-promotion flow intact
 * AC: no production write to .pan/continues/ or .pan/continue.json (beyond legacy exceptions)
 * AC: .pan/records/<issue>.json is not gitignored
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = join(import.meta.dirname, '../../../../');

describe('PAN-1919: retire dead continue modules', () => {
  it('AC1: continues.ts is deleted', () => {
    expect(existsSync(join(ROOT, 'src/lib/pan-dir/continues.ts'))).toBe(false);
  });

  it('AC1: continues.ts exports absent from pan-dir/index.ts', () => {
    const idx = readFileSync(join(ROOT, 'src/lib/pan-dir/index.ts'), 'utf-8');
    expect(idx).not.toContain("from './continues.js'");
    expect(idx).not.toContain('getContinuesDir');
    expect(idx).not.toContain('getContinueFilePath');
  });

  it('AC1: no non-test production reference to continues.ts', () => {
    const result = execSync(
      `git grep -rn "pan-dir/continues" -- 'src/' ':!src/**/__tests__/*' || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).toBe('');
  });

  it('AC2: continue-state.ts exports no fs-I/O functions', () => {
    const src = readFileSync(join(ROOT, 'src/lib/vbrief/continue-state.ts'), 'utf-8');
    expect(src).not.toContain('readFileSync');
    expect(src).not.toContain('writeFileSync');
    expect(src).not.toContain('writeFile(');
    expect(src).not.toContain('readFile(');
    expect(src).not.toContain('export function readContinueStateSync');
    expect(src).not.toContain('export function writeContinueStateSync');
    expect(src).not.toContain('export const writeContinueState');
    expect(src).not.toContain('export const readContinueState');
  });

  it('AC2: continue-state.ts still exports ContinueState interface', () => {
    const src = readFileSync(join(ROOT, 'src/lib/vbrief/continue-state.ts'), 'utf-8');
    expect(src).toContain('export interface ContinueState');
    expect(src).toContain('export interface ContinueFeedbackEntry');
    expect(src).toContain('export interface ContinueSessionEntry');
  });

  it('AC2: pan-dir/continue.ts no longer exports readWorkspaceContinue/writeWorkspaceContinue', () => {
    const src = readFileSync(join(ROOT, 'src/lib/pan-dir/continue.ts'), 'utf-8');
    expect(src).not.toContain('readWorkspaceContinue');
    expect(src).not.toContain('writeWorkspaceContinue');
    expect(src).toContain('export function getWorkspacePanPaths');
    expect(src).toContain('export function ensureWorkspacePanDir');
  });

  it('AC3: promoteContinueToProject absent from lifecycle-io.ts', () => {
    const result = execSync(
      `git grep -n "promoteContinueToProject" -- src/lib/vbrief/lifecycle-io.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).toBe('');
  });

  it('AC3: promoteContinueToProject absent from routes/issues.ts', () => {
    const result = execSync(
      `git grep -n "promoteContinueToProject" -- src/dashboard/server/routes/issues.ts || true`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.trim()).toBe('');
  });

  it('AC4: .pan/records/pan-1919.json is not gitignored', () => {
    const result = execSync(
      `git check-ignore -v .pan/records/pan-1919.json; echo $?`,
      { cwd: ROOT, encoding: 'utf-8' },
    );
    // exit code 1 means NOT ignored; git check-ignore outputs nothing and exits 1
    const exitCode = result.trim().split('\n').pop();
    expect(exitCode).toBe('1');
  });

  it('AC: lint-state-writes exits 0 after module retirement', () => {
    const result = execSync(
      'bash scripts/lint-state-writes.sh 2>&1 || echo EXIT_NONZERO',
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result).toContain('✓ state-write lint passed');
    expect(result).not.toContain('EXIT_NONZERO');
  });
});
