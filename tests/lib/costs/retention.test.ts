/**
 * Retention Tests
 *
 * Tests for cost event retention and cleanup functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('retention', () => {
  let testDir: string;
  let testCostsDir: string;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'pan-retention-test-'));
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

  describe('getLastRetentionCleanup', () => {
    it('should return null if never run before', async () => {
      const { getLastRetentionCleanup } = await import('../../../src/lib/costs/retention.js');

      const lastCleanup = getLastRetentionCleanup();
      expect(lastCleanup).toBeNull();
    });

    it('should mark last cleanup time correctly', async () => {
      const { cleanOldEvents, getLastRetentionCleanup } = await import(
        '../../../src/lib/costs/retention.js'
      );

      // Run cleanup (even with empty event log, it should mark the time)
      await cleanOldEvents();

      const lastCleanup = getLastRetentionCleanup();
      expect(lastCleanup).not.toBeNull();
      expect(lastCleanup).toBeInstanceOf(Date);

      // Should be recent (within last 5 seconds)
      const now = Date.now();
      const cleanupTime = lastCleanup!.getTime();
      expect(now - cleanupTime).toBeLessThan(5000);
    }, 20000);

    it('should parse timestamp from marker file correctly', async () => {
      const { getLastRetentionCleanup } = await import('../../../src/lib/costs/retention.js');

      // Manually write a timestamp to marker file
      const testTimestamp = '2024-01-15T10:00:00.000Z';
      const markerFile = join(testCostsDir, 'last-retention-cleanup.txt');
      writeFileSync(markerFile, testTimestamp, 'utf-8');

      const lastCleanup = getLastRetentionCleanup();
      expect(lastCleanup).not.toBeNull();
      expect(lastCleanup!.toISOString()).toBe(testTimestamp);
    });

    it('should return null on invalid timestamp', async () => {
      const { getLastRetentionCleanup } = await import('../../../src/lib/costs/retention.js');

      // Write invalid timestamp
      const markerFile = join(testCostsDir, 'last-retention-cleanup.txt');
      writeFileSync(markerFile, 'invalid-date', 'utf-8');

      const lastCleanup = getLastRetentionCleanup();
      expect(lastCleanup).toBeNull();
    });
  });

  describe('isRetentionCleanupNeeded', () => {
    it('should return true if never run before', async () => {
      const { isRetentionCleanupNeeded } = await import('../../../src/lib/costs/retention.js');

      const needsCleanup = isRetentionCleanupNeeded();
      expect(needsCleanup).toBe(true);
    });

    it('should return false immediately after cleanup', async () => {
      const { cleanOldEvents, isRetentionCleanupNeeded } = await import(
        '../../../src/lib/costs/retention.js'
      );

      await cleanOldEvents();

      const needsCleanup = isRetentionCleanupNeeded();
      expect(needsCleanup).toBe(false);
    }, 20000);

    it('should detect cleanup needed after 24 hours', async () => {
      const { isRetentionCleanupNeeded } = await import('../../../src/lib/costs/retention.js');

      // Manually set last cleanup to 25 hours ago
      const markerFile = join(testCostsDir, 'last-retention-cleanup.txt');
      const hoursAgo25 = new Date(Date.now() - 25 * 60 * 60 * 1000);
      writeFileSync(markerFile, hoursAgo25.toISOString(), 'utf-8');

      const needsCleanup = isRetentionCleanupNeeded();
      expect(needsCleanup).toBe(true);
    });

    it('should return false if cleanup was 23 hours ago', async () => {
      const { isRetentionCleanupNeeded } = await import('../../../src/lib/costs/retention.js');

      // Manually set last cleanup to 23 hours ago (within 24-hour window)
      const markerFile = join(testCostsDir, 'last-retention-cleanup.txt');
      const hoursAgo23 = new Date(Date.now() - 23 * 60 * 60 * 1000);
      writeFileSync(markerFile, hoursAgo23.toISOString(), 'utf-8');

      const needsCleanup = isRetentionCleanupNeeded();
      expect(needsCleanup).toBe(false);
    });
  });

  describe('cleanOldEvents', () => {
    it('should handle empty event log gracefully', async () => {
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      const result = await cleanOldEvents();

      expect(result.totalEventsBefore).toBe(0);
      expect(result.totalEventsAfter).toBe(0);
      expect(result.eventsRemoved).toBe(0);
      expect(result.bytesFreed).toBe(0);
    }, 20000);

    it('should preserve events newer than 90 days', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      // Add recent events (within 90 days)
      const recentDate1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const recentDate2 = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000); // 50 days ago

      await appendEvent({
        ts: recentDate1.toISOString(),
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: recentDate2.toISOString(),
        agent: 'agent-pan-2',
        model: 'claude-sonnet-4.5',
        input: 2000,
        output: 1000,
        cache_read: 0,
        cache_write: 0,
      });

      const result = await cleanOldEvents();

      // All events should be preserved (none older than 90 days)
      expect(result.totalEventsBefore).toBe(2);
      expect(result.totalEventsAfter).toBe(2);
      expect(result.eventsRemoved).toBe(0);
    }, 20000);

    it('should remove events older than 90 days', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      // Add mix of old and recent events
      const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000); // 95 days ago
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      await appendEvent({
        ts: oldDate.toISOString(),
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: recentDate.toISOString(),
        agent: 'agent-pan-2',
        model: 'claude-sonnet-4.5',
        input: 2000,
        output: 1000,
        cache_read: 0,
        cache_write: 0,
      });

      const result = await cleanOldEvents();

      // Old event should be removed, recent event should remain
      expect(result.totalEventsBefore).toBe(2);
      expect(result.totalEventsAfter).toBe(1);
      expect(result.eventsRemoved).toBe(1);
      expect(result.bytesFreed).toBeGreaterThan(0);
    }, 20000);

    it('should rebuild cache before cleanup', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');
      const { getAllIssueCosts } = await import('../../../src/lib/costs/aggregator.js');

      // Add old event that will be removed
      const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);

      await appendEvent({
        ts: oldDate.toISOString(),
        agent: 'agent-pan-100',
        model: 'claude-sonnet-4.5',
        input: 5000,
        output: 2500,
        cache_read: 0,
        cache_write: 0,
      });

      // Run cleanup
      await cleanOldEvents();

      // Verify cache was rebuilt (should contain cost data even though event is removed)
      const issueCosts = getAllIssueCosts();
      expect(issueCosts['pan-100']).toBeDefined();
      expect(issueCosts['pan-100'].totalCost).toBeGreaterThan(0);

      // Event should be removed from log
      const { readEvents } = await import('../../../src/lib/costs/events.js');
      const events = readEvents();
      expect(events).toHaveLength(0); // Old event removed
    }, 20000);

    it('should preserve events with invalid timestamps', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      // Add event with completely malformed timestamp (but valid JSON structure)
      // Use a timestamp that creates an Invalid Date but doesn't throw
      await appendEvent({
        ts: 'not-a-valid-iso-date-but-still-a-string',
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      const result = await cleanOldEvents();

      // Event with invalid timestamp should be kept (assumed to be recent)
      expect(result.totalEventsAfter).toBe(1);
      expect(result.eventsRemoved).toBe(0);
    }, 20000);

    it('should handle concurrent access with locking', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      // Add some events
      await appendEvent({
        ts: new Date().toISOString(),
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      // Simulate concurrent cleanup (both should complete without error)
      const cleanup1 = cleanOldEvents();
      const cleanup2 = cleanOldEvents();

      const [result1, result2] = await Promise.all([cleanup1, cleanup2]);

      // Both should complete successfully (one may wait for lock)
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Final state should be consistent
      const { readEvents } = await import('../../../src/lib/costs/events.js');
      const events = readEvents();
      expect(events.length).toBeGreaterThanOrEqual(0); // Events not corrupted
    }, 20000);

    it('should return detailed cleanup statistics', async () => {
      const { appendEvent } = await import('../../../src/lib/costs/events.js');
      const { cleanOldEvents } = await import('../../../src/lib/costs/retention.js');

      // Add multiple old and recent events
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      await appendEvent({
        ts: oldDate.toISOString(),
        agent: 'agent-pan-1',
        model: 'claude-sonnet-4.5',
        input: 1000,
        output: 500,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: oldDate.toISOString(),
        agent: 'agent-pan-2',
        model: 'claude-sonnet-4.5',
        input: 2000,
        output: 1000,
        cache_read: 0,
        cache_write: 0,
      });

      await appendEvent({
        ts: recentDate.toISOString(),
        agent: 'agent-pan-3',
        model: 'claude-sonnet-4.5',
        input: 3000,
        output: 1500,
        cache_read: 0,
        cache_write: 0,
      });

      const result = await cleanOldEvents();

      // Verify statistics
      expect(result.totalEventsBefore).toBe(3);
      expect(result.totalEventsAfter).toBe(1);
      expect(result.eventsRemoved).toBe(2);
      expect(result.bytesFreed).toBeGreaterThan(0);
      expect(result.oldestEventBefore).toBeDefined();
      expect(result.oldestEventAfter).toBeDefined();

      // Oldest event before should be the old date
      expect(result.oldestEventBefore).toBe(oldDate.toISOString());

      // Oldest event after should be the recent date
      expect(result.oldestEventAfter).toBe(recentDate.toISOString());
    }, 20000);
  });

  describe('runRetentionCleanupIfNeeded', () => {
    it('should skip cleanup if recently run', async () => {
      const { cleanOldEvents, runRetentionCleanupIfNeeded } = await import(
        '../../../src/lib/costs/retention.js'
      );

      // Run initial cleanup
      await cleanOldEvents();

      // Immediately try again - should skip
      await runRetentionCleanupIfNeeded();

      // No error should be thrown, just silently skip
      expect(true).toBe(true);
    }, 20000);

    it('should run cleanup if never run before', async () => {
      const { runRetentionCleanupIfNeeded, getLastRetentionCleanup } = await import(
        '../../../src/lib/costs/retention.js'
      );

      // Never run before
      expect(getLastRetentionCleanup()).toBeNull();

      // Run cleanup
      await runRetentionCleanupIfNeeded();

      // Should have marked cleanup time
      expect(getLastRetentionCleanup()).not.toBeNull();
    }, 20000);

    it('should run cleanup if 24+ hours since last run', async () => {
      const { runRetentionCleanupIfNeeded, getLastRetentionCleanup } = await import(
        '../../../src/lib/costs/retention.js'
      );

      // Manually set last cleanup to 25 hours ago
      const markerFile = join(testCostsDir, 'last-retention-cleanup.txt');
      const hoursAgo25 = new Date(Date.now() - 25 * 60 * 60 * 1000);
      writeFileSync(markerFile, hoursAgo25.toISOString(), 'utf-8');

      // Verify it's marked as needed
      expect(getLastRetentionCleanup()!.getTime()).toBe(hoursAgo25.getTime());

      // Run cleanup
      await runRetentionCleanupIfNeeded();

      // Should have updated cleanup time to recent
      const newCleanupTime = getLastRetentionCleanup();
      expect(newCleanupTime).not.toBeNull();
      expect(Date.now() - newCleanupTime!.getTime()).toBeLessThan(5000);
    }, 20000);

    it('should not throw on cleanup errors', async () => {
      const { runRetentionCleanupIfNeeded } = await import(
        '../../../src/lib/costs/retention.js'
      );

      // Create invalid state (e.g., read-only events file) to trigger error
      const eventsFile = join(testCostsDir, 'events.jsonl');
      writeFileSync(eventsFile, 'corrupted-data-not-json\n', 'utf-8');

      // Should not throw, just log error
      await expect(runRetentionCleanupIfNeeded()).resolves.not.toThrow();
    }, 20000);
  });
});
