import { join } from 'path';
import { describe, expect } from '@effect/vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  getDocsBudgetStatePath,
  getDocsDir,
  getDocsDisableStatePath,
  getDocsIndexPath,
  getDocsPaths,
  getDocsTelemetryPath,
  resolvePackageRootForDir,
} from '../paths.js';

describe('docs RAG paths', () => {
  it.effect('resolves docs state under PANOPTICON_HOME', () =>
    Effect.sync(() => {
      expect(getDocsPaths({ panopticonHome: '/tmp/pan-home' })).toEqual({
        docsDir: join('/tmp/pan-home', 'docs'),
        indexPath: join('/tmp/pan-home', 'docs', 'index.sqlite'),
        budgetStatePath: join('/tmp/pan-home', 'docs', 'budget-state.json'),
        disableStatePath: join('/tmp/pan-home', 'docs', 'disable-state.json'),
        telemetryPath: join('/tmp/pan-home', 'docs', 'telemetry.jsonl'),
      });
    })
  );

  it.effect('supports path overrides for tests', () =>
    Effect.sync(() => {
      const overrides = {
        docsDir: '/tmp/docs-state',
        indexPath: '/tmp/index.sqlite',
        budgetStatePath: '/tmp/budget.json',
        disableStatePath: '/tmp/disable.json',
        telemetryPath: '/tmp/telemetry.jsonl',
      };

      expect(getDocsDir(overrides)).toBe('/tmp/docs-state');
      expect(getDocsIndexPath(overrides)).toBe('/tmp/index.sqlite');
      expect(getDocsBudgetStatePath(overrides)).toBe('/tmp/budget.json');
      expect(getDocsDisableStatePath(overrides)).toBe('/tmp/disable.json');
      expect(getDocsTelemetryPath(overrides)).toBe('/tmp/telemetry.jsonl');
    })
  );
});

describe('resolvePackageRootForDir', () => {
  it.effect('resolves source module paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'src', 'lib'))).toBe('/repo');
    })
  );

  it.effect('resolves bundled CLI paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'cli'))).toBe('/repo');
    })
  );

  it.effect('resolves bundled dashboard paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'dashboard'))).toBe('/repo');
    })
  );

  it.effect('resolves unbundled dist lib paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'lib'))).toBe('/repo');
    })
  );
});
