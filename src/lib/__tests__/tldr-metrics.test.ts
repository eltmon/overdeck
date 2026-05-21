/**
 * Tests for TLDR session metrics tracking (PAN-236)
 *
 * Tests getTldrMetrics() accumulation and captureTldrMetrics() reset behavior.
 */

import { beforeEach, afterEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getTldrMetrics, captureTldrMetrics } from '../tldr-daemon.js';

let TEST_WORKSPACE: string;

beforeEach(() => {
  TEST_WORKSPACE = join(tmpdir(), `tldr-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(TEST_WORKSPACE, '.tldr'), { recursive: true });
});

afterEach(() => {
  if (TEST_WORKSPACE && existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
});

function writeInterceptions(lines: string[]): void {
  writeFileSync(
    join(TEST_WORKSPACE, '.tldr', 'interceptions.log'),
    lines.join('\n') + '\n',
    'utf-8'
  );
}

function writeBypasses(lines: string[]): void {
  writeFileSync(
    join(TEST_WORKSPACE, '.tldr', 'bypasses.log'),
    lines.join('\n') + '\n',
    'utf-8'
  );
}

function writeCheckpoint(interceptionsLine: number, bypassesLine: number): void {
  writeFileSync(
    join(TEST_WORKSPACE, '.tldr', 'metrics-checkpoint.json'),
    JSON.stringify({ interceptionsLine, bypassesLine, capturedAt: new Date().toISOString() }),
    'utf-8'
  );
}

// ============ getTldrMetrics ============

describe('getTldrMetrics', () => {
  it.effect('returns zeros when workspace has no log files', () =>
    Effect.gen(function* () {
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.interceptions).toBe(0);
      expect(metrics.bypasses).toBe(0);
      expect(metrics.estimatedTokensSaved).toBe(0);
      expect(metrics.filesAnalyzed).toEqual([]);
      expect(metrics.bypassReasons).toEqual({});
    })
  );

  it.effect('counts interceptions from interceptions.log', () =>
    Effect.gen(function* () {
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',
        '1700000002 12000 src/lib/costs/events.ts',
        '1700000003 5000 src/lib/tldr-daemon.ts',
      ]);
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.interceptions).toBe(3);
    })
  );

  it.effect('estimates tokens saved from file sizes', () =>
    Effect.gen(function* () {
      // 8000 bytes → ~2000 tokens full; 2000 - 1000 = 1000 saved
      writeInterceptions(['1700000001 8000 src/lib/agents.ts']);
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.estimatedTokensSaved).toBe(1000);
    })
  );

  it.effect('never produces negative token savings for small files', () =>
    Effect.gen(function* () {
      // 3500 bytes → ~875 tokens full; summary (~1000) > full → savings = 0
      writeInterceptions(['1700000001 3500 src/lib/small.ts']);
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.estimatedTokensSaved).toBe(0);
    })
  );

  it.effect('tracks unique files in filesAnalyzed', () =>
    Effect.gen(function* () {
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',
        '1700000002 8000 src/lib/agents.ts', // same file twice
        '1700000003 8000 src/lib/costs.ts',
      ]);
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.filesAnalyzed).toHaveLength(2);
      expect(metrics.filesAnalyzed).toContain('src/lib/agents.ts');
      expect(metrics.filesAnalyzed).toContain('src/lib/costs.ts');
    })
  );

  it.effect('counts bypasses and groups by reason', () =>
    Effect.gen(function* () {
      writeBypasses([
        '1700000001 offset-limit src/lib/agents.ts',
        '1700000002 offset-limit src/lib/costs.ts',
        '1700000003 recently-edited src/lib/settings.ts',
      ]);
      const metrics = yield* getTldrMetrics(TEST_WORKSPACE);
      expect(metrics.bypasses).toBe(3);
      expect(metrics.bypassReasons['offset-limit']).toBe(2);
      expect(metrics.bypassReasons['recently-edited']).toBe(1);
    })
  );

  it.effect('respects sinceCheckpoint=true when checkpoint exists', () =>
    Effect.gen(function* () {
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',     // line 0 — before checkpoint
        '1700000002 12000 src/lib/costs.ts',      // line 1 — before checkpoint
        '1700000003 5000 src/lib/new-file.ts',    // line 2 — after checkpoint
      ]);
      writeCheckpoint(2, 0); // 2 interceptions already captured

      const metrics = yield* getTldrMetrics(TEST_WORKSPACE, true);
      expect(metrics.interceptions).toBe(1); // only line 2
      expect(metrics.filesAnalyzed).toEqual(['src/lib/new-file.ts']);
    })
  );

  it.effect('returns all metrics when sinceCheckpoint=false even with checkpoint', () =>
    Effect.gen(function* () {
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',
        '1700000002 8000 src/lib/costs.ts',
      ]);
      writeCheckpoint(1, 0); // 1 already captured

      const metrics = yield* getTldrMetrics(TEST_WORKSPACE, false);
      expect(metrics.interceptions).toBe(2); // all lines
    })
  );
});

// ============ captureTldrMetrics ============

describe('captureTldrMetrics', () => {
  it.effect('returns null when .tldr/ does not exist', () =>
    Effect.gen(function* () {
      const noTldrWorkspace = join(tmpdir(), `no-tldr-${Date.now()}`);
      mkdirSync(noTldrWorkspace, { recursive: true });
      try {
        const result = yield* captureTldrMetrics(noTldrWorkspace);
        expect(result).toBeNull();
      } finally {
        rmSync(noTldrWorkspace, { recursive: true, force: true });
      }
    })
  );

  it.effect('returns empty metrics and writes checkpoint when no logs exist', () =>
    Effect.gen(function* () {
      const metrics = yield* captureTldrMetrics(TEST_WORKSPACE);
      expect(metrics).not.toBeNull();
      expect(metrics!.interceptions).toBe(0);
      expect(metrics!.bypasses).toBe(0);

      const checkpointFile = join(TEST_WORKSPACE, '.tldr', 'metrics-checkpoint.json');
      expect(existsSync(checkpointFile)).toBe(true);
    })
  );

  it.effect('captures metrics since last checkpoint and advances checkpoint', () =>
    Effect.gen(function* () {
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',   // already captured
        '1700000002 8000 src/lib/costs.ts',    // new
      ]);
      writeBypasses([
        '1700000001 offset-limit src/lib/agents.ts', // new
      ]);
      writeCheckpoint(1, 0); // 1 interception captured, 0 bypasses captured

      const metrics = (yield* captureTldrMetrics(TEST_WORKSPACE))!;
      expect(metrics.interceptions).toBe(1);  // only line 1 (index 1)
      expect(metrics.filesAnalyzed).toEqual(['src/lib/costs.ts']);
      expect(metrics.bypasses).toBe(1);
      expect(metrics.bypassReasons['offset-limit']).toBe(1);

      // Checkpoint should now point to end of both logs
      const checkpoint = JSON.parse(
        readFileSync(join(TEST_WORKSPACE, '.tldr', 'metrics-checkpoint.json'), 'utf-8')
      );
      expect(checkpoint.interceptionsLine).toBe(2);
      expect(checkpoint.bypassesLine).toBe(1);
      expect(checkpoint.interceptionsByte).toBeGreaterThan(0);
      expect(checkpoint.bypassesByte).toBeGreaterThan(0);
    })
  );

  it.effect('uses byte checkpoints for subsequent captures', () =>
    Effect.gen(function* () {
      writeInterceptions(['1700000001 8000 src/lib/agents.ts']);
      yield* captureTldrMetrics(TEST_WORKSPACE);
      writeInterceptions([
        '1700000001 8000 src/lib/agents.ts',
        '1700000002 8000 src/lib/new.ts',
      ]);

      const second = (yield* captureTldrMetrics(TEST_WORKSPACE))!;
      expect(second.interceptions).toBe(1);
      expect(second.filesAnalyzed).toEqual(['src/lib/new.ts']);
    })
  );

  it.effect('returns zero delta on second capture with no new events', () =>
    Effect.gen(function* () {
      writeInterceptions(['1700000001 8000 src/lib/agents.ts']);
      yield* captureTldrMetrics(TEST_WORKSPACE); // first capture

      const second = (yield* captureTldrMetrics(TEST_WORKSPACE))!;
      expect(second.interceptions).toBe(0);
      expect(second.bypasses).toBe(0);
      expect(second.estimatedTokensSaved).toBe(0);
    })
  );

  it.effect('accumulates correctly across multiple captures', () =>
    Effect.gen(function* () {
      // First batch: 2 interceptions
      writeInterceptions([
        '1700000001 8000 src/a.ts',
        '1700000002 8000 src/b.ts',
      ]);
      const first = (yield* captureTldrMetrics(TEST_WORKSPACE))!;
      expect(first.interceptions).toBe(2);

      // Second batch: 1 more interception
      writeInterceptions([
        '1700000001 8000 src/a.ts',
        '1700000002 8000 src/b.ts',
        '1700000003 8000 src/c.ts',
      ]);
      const second = (yield* captureTldrMetrics(TEST_WORKSPACE))!;
      expect(second.interceptions).toBe(1); // only the new one
      expect(second.filesAnalyzed).toEqual(['src/c.ts']);
    })
  );
});
