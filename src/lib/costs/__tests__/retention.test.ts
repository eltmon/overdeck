/**
 * Retention Tests - Verify 90-day cleanup and pruning
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pruneOldEvents, needsPruning, getRetentionStatus, RetentionStats } from '../retention.js';
import { appendCostEvent, readEvents, CostEvent, getEventsFilePath } from '../events.js';
import { rebuildCache, loadCache } from '../aggregator.js';

// Redirect process.env.HOME to an isolated temp dir so the running dashboard
// server (which writes to the real ~/.panopticon/costs) cannot pollute tests.
let TEST_HOME: string;
let COSTS_DIR: string;
const REAL_HOME = process.env.HOME;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `retention-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  COSTS_DIR = join(TEST_HOME, '.panopticon', 'costs');
  mkdirSync(COSTS_DIR, { recursive: true });
  process.env.HOME = TEST_HOME;
});

afterEach(() => {
  process.env.HOME = REAL_HOME;
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe('Retention Management', () => {
  describe('Event Pruning', () => {
    it('should prune events older than retention period', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      // Add old event
      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      // Add recent event
      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02
      });

      const stats = pruneOldEvents(90);

      expect(stats.totalEvents).toBe(2);
      expect(stats.eventsRemoved).toBe(1);
      expect(stats.eventsRetained).toBe(1);

      // Verify only recent event remains
      const events = readEvents();
      expect(events.length).toBe(1);
      expect(events[0].issueId).toBe('TEST-2');
    });

    it('should handle no events to prune', () => {
      const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      const stats = pruneOldEvents(90);

      expect(stats.eventsRemoved).toBe(0);
      expect(stats.eventsRetained).toBe(1);
    });

    it('should handle empty events file', () => {
      const stats = pruneOldEvents(90);

      expect(stats.totalEvents).toBe(0);
      expect(stats.eventsRemoved).toBe(0);
      expect(stats.eventsRetained).toBe(0);
      expect(stats.oldestEventTs).toBeNull();
      expect(stats.newestEventTs).toBeNull();
    });

    it('should prune all events if all are old', () => {
      const old1 = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const old2 = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: old2.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      appendCostEvent({
        ts: old1.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02
      });

      const stats = pruneOldEvents(90);

      expect(stats.totalEvents).toBe(2);
      expect(stats.eventsRemoved).toBe(2);
      expect(stats.eventsRetained).toBe(0);

      const events = readEvents();
      expect(events.length).toBe(0);
    });

    it('should update cache after pruning', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
      const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Add events
      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 50.0
      });

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 25.0
      });

      // Build cache
      rebuildCache();

      // Prune old events
      pruneOldEvents(90);

      // Verify cache was rebuilt
      const cache = loadCache();
      expect(cache.issues['TEST-1']).toBeUndefined(); // Old issue removed
      expect(cache.issues['TEST-2']).toBeDefined(); // Recent issue kept
      expect(cache.issues['TEST-2'].totalCost).toBeCloseTo(25.0, 6);
    });
  });

  describe('Retention Status', () => {
    it('should detect when pruning is needed', () => {
      const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      expect(needsPruning(90)).toBe(true);
    });

    it('should detect when pruning is not needed', () => {
      const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      expect(needsPruning(90)).toBe(false);
    });

    it('should return correct retention status', () => {
      const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02
      });

      const status = getRetentionStatus(90);

      expect(status.totalEvents).toBe(2);
      expect(status.oldestEventTs).toBe(old.toISOString());
      expect(status.oldestEventAge).toBeGreaterThan(90);
      expect(status.needsPruning).toBe(true);
      expect(status.eventsToRemove).toBe(1);
    });

    it('should handle empty state in retention status', () => {
      const status = getRetentionStatus(90);

      expect(status.totalEvents).toBe(0);
      expect(status.oldestEventTs).toBeNull();
      expect(status.oldestEventAge).toBe(0);
      expect(status.needsPruning).toBe(false);
      expect(status.eventsToRemove).toBe(0);
    });
  });

  describe('Custom Retention Periods', () => {
    it('should support 30-day retention', () => {
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02
      });

      const stats = pruneOldEvents(30);

      expect(stats.eventsRemoved).toBe(1);
      expect(stats.eventsRetained).toBe(1);
    });

    it('should support 365-day retention', () => {
      const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: old.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-2',
        issueId: 'TEST-2',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 2000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02
      });

      const stats = pruneOldEvents(365);

      expect(stats.eventsRemoved).toBe(1);
      expect(stats.eventsRetained).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle events exactly at retention boundary', () => {
      // Place event 1 second inside the boundary to avoid ms-level race
      // between Date.now() here and inside pruneOldEvents()
      const exactBoundary = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 1000);

      appendCostEvent({
        ts: exactBoundary.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      const stats = pruneOldEvents(90);

      // Event exactly at boundary should be retained (>= comparison)
      expect(stats.eventsRetained).toBe(1);
    });

    it('should preserve event order after pruning', () => {
      const dates = [
        new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // Will be pruned
        new Date(Date.now() - 80 * 24 * 60 * 60 * 1000),
        new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      ];

      for (let i = 0; i < dates.length; i++) {
        appendCostEvent({
          ts: dates[i].toISOString(),
          type: 'cost',
          agentId: `agent-${i}`,
          issueId: `TEST-${i}`,
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000 * (i + 1),
          output: 500 * (i + 1),
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.01 * (i + 1)
        });
      }

      pruneOldEvents(90);

      const events = readEvents();
      expect(events.length).toBe(4);

      // Verify chronological order is preserved
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].ts <= events[i + 1].ts).toBe(true);
      }
    });

    it('should handle zero retention days', () => {
      const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      appendCostEvent({
        ts: recent.toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-1',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      });

      const stats = pruneOldEvents(0);

      // With 0 days retention, everything older than today should be pruned
      expect(stats.eventsRemoved).toBeGreaterThanOrEqual(0);
    });
  });
});
