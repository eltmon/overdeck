/**
 * Migration Safety Tests
 *
 * Tests for cost data migration functionality.
 * Note: Full integration tests require complex Claude Code session directory mocking.
 * These tests focus on verifiable unit behaviors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('migration safety', () => {
  let testDir: string;
  let testCostsDir: string;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'pan-migration-test-'));
    testCostsDir = join(testDir, 'costs');
    mkdirSync(testCostsDir, { recursive: true });

    // Mock the paths module
    vi.doMock('../../../src/lib/paths.js', () => ({
      PANOPTICON_HOME: testDir,
      CONFIG_DIR: testDir,
      SKILLS_DIR: join(testDir, 'skills'),
      COMMANDS_DIR: join(testDir, 'commands'),
      AGENTS_DIR: join(testDir, 'agents'),
      BIN_DIR: join(testDir, 'bin'),
      BACKUPS_DIR: join(testDir, 'backups'),
      COSTS_DIR: testCostsDir,
      HEARTBEATS_DIR: join(testDir, 'heartbeats'),
      TRAEFIK_DIR: join(testDir, 'traefik'),
      TRAEFIK_DYNAMIC_DIR: join(testDir, 'traefik', 'dynamic'),
      TRAEFIK_CERTS_DIR: join(testDir, 'traefik', 'certs'),
      CERTS_DIR: join(testDir, 'certs'),
      CONFIG_FILE: join(testDir, 'config.toml'),
      CLAUDE_DIR: join(testDir, '.claude'),
      CODEX_DIR: join(testDir, '.codex'),
      CURSOR_DIR: join(testDir, '.cursor'),
      GEMINI_DIR: join(testDir, '.gemini'),
      SYNC_TARGETS: {},
    }));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.resetModules();
  });

  describe('migration state', () => {
    it('should mark migration complete and persist state', async () => {
      const { runMigration, isMigrationComplete, getMigrationState } = await import(
        '../../../src/lib/costs/migration.js'
      );

      // Initial state: not complete
      expect(isMigrationComplete()).toBe(false);

      // Run migration (no workspaces, but should still complete)
      const result = await runMigration();

      expect(result.completed).toBe(true);
      expect(isMigrationComplete()).toBe(true);

      // State should be persisted
      const state = getMigrationState();
      expect(state).toBeDefined();
      expect(state?.completed).toBe(true);
      expect(state?.completedAt).toBeDefined();
    }, 20000);

    it('should skip migration if already complete (idempotency)', async () => {
      const { runMigration, isMigrationComplete } = await import(
        '../../../src/lib/costs/migration.js'
      );

      // First run
      const result1 = await runMigration();
      expect(result1.completed).toBe(true);
      expect(isMigrationComplete()).toBe(true);

      // Second run should return cached state, not re-run
      const result2 = await runMigration();
      expect(result2.completed).toBe(true);
      // Both should have same completedAt timestamp (cached)
      expect(result1.completedAt).toBe(result2.completedAt);
    }, 20000);
  });

  describe('empty state handling', () => {
    it('should handle empty agents directory gracefully', async () => {
      const { runMigration } = await import('../../../src/lib/costs/migration.js');

      // Create agents directory but leave it empty
      mkdirSync(join(testDir, 'agents'), { recursive: true });

      const result = await runMigration();

      expect(result.completed).toBe(true);
      expect(result.eventCount).toBe(0);
      expect(result.workspaceCount).toBe(0);
    }, 20000);

    it('should handle missing agents directory', async () => {
      const { runMigration } = await import('../../../src/lib/costs/migration.js');

      // Don't create agents directory - should still work
      const result = await runMigration();

      expect(result.completed).toBe(true);
      expect(result.eventCount).toBe(0);
    }, 20000);
  });

  describe('event log operations', () => {
    it('should correctly append and read events', async () => {
      const { appendEvent, readEvents } = await import('../../../src/lib/costs/events.js');

      const event1 = {
        ts: '2024-01-15T10:00:00Z',
        agent: 'agent-pan-123',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      };

      const event2 = {
        ts: '2024-01-15T11:00:00Z',
        agent: 'agent-pan-123',
        model: 'claude-sonnet-4.5',
        input: 2000,
        output: 1000,
        cache_read: 0,
        cache_write: 0,
      };

      await appendEvent(event1);
      await appendEvent(event2);

      const events = readEvents();

      expect(events).toHaveLength(2);
      expect(events[0].ts).toBe(event1.ts);
      expect(events[1].ts).toBe(event2.ts);
      expect(events[0].input).toBe(1000);
      expect(events[1].input).toBe(2000);
    }, 20000);

    it('should preserve event order on read', async () => {
      const { appendEvent, readEvents } = await import('../../../src/lib/costs/events.js');

      // Append events in sequence
      for (let i = 0; i < 5; i++) {
        await appendEvent({
          ts: `2024-01-15T1${i}:00:00Z`,
          agent: 'agent-pan-123',
          model: 'claude-sonnet-4.5',
          input: 100 * (i + 1),
          output: 50 * (i + 1),
          cache_read: 0,
          cache_write: 0,
        });
      }

      const events = readEvents();

      expect(events).toHaveLength(5);
      // Verify order is preserved
      for (let i = 0; i < 5; i++) {
        expect(events[i].input).toBe(100 * (i + 1));
      }
    }, 20000);
  });

  describe('aggregation cache', () => {
    it('should rebuild cache from events correctly', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { rebuildFromEvents, getAllIssueCosts } = await import(
        '../../../src/lib/costs/aggregator.js'
      );

      // Add events for multiple issues (agent name format: agent-<issue>)
      await appendEvent({
        ts: '2024-01-15T10:00:00Z',
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: '2024-01-15T11:00:00Z',
        agent: 'agent-pan-2',
        model: 'claude-opus-4.5',
        input: 500,
        output: 250,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: '2024-01-15T12:00:00Z',
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 500,
        output: 250,
        cache_read: 0,
        cache_write: 0,
      });

      rebuildFromEvents();

      const issueCosts = getAllIssueCosts();

      expect(issueCosts['pan-1']).toBeDefined();
      expect(issueCosts['pan-2']).toBeDefined();

      // pan-1 has two events
      expect(issueCosts['pan-1'].totalCost).toBeGreaterThan(0);

      // pan-2 has one event
      expect(issueCosts['pan-2'].totalCost).toBeGreaterThan(0);
    }, 20000);

    it('should track event count correctly', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { rebuildFromEvents, getAllIssueCosts } = await import(
        '../../../src/lib/costs/aggregator.js'
      );

      // Add 3 events for same issue
      for (let i = 0; i < 3; i++) {
        await appendEvent({
          ts: `2024-01-15T1${i}:00:00Z`,
          agent: 'agent-pan-100',
          model: 'claude-sonnet-4.5',
          input: 100,
          output: 50,
          cache_read: 0,
          cache_write: 0,
        });
      }

      rebuildFromEvents();

      const issueCosts = getAllIssueCosts();
      expect(issueCosts['pan-100'].eventCount).toBe(3);
    }, 20000);
  });
});
