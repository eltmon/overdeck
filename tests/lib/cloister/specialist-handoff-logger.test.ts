/**
 * Tests for specialist-handoff-logger.ts - PAN-83
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  logSpecialistHandoff,
  createSpecialistHandoff,
  readSpecialistHandoffs,
  readIssueSpecialistHandoffs,
  getSpecialistHandoffStats,
  getTodaySpecialistHandoffs,
} from '../../../src/lib/cloister/specialist-handoff-logger.js';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from '../../../src/lib/paths.js';

const TEST_LOG_FILE = join(PANOPTICON_HOME, 'logs', 'specialist-handoffs.jsonl');
const TEST_LOG_DIR = join(PANOPTICON_HOME, 'logs');

describe('specialist-handoff-logger', () => {
  beforeEach(() => {
    // Clean up test log file
    if (existsSync(TEST_LOG_FILE)) {
      unlinkSync(TEST_LOG_FILE);
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_LOG_FILE)) {
      unlinkSync(TEST_LOG_FILE);
    }
  });

  describe('createSpecialistHandoff', () => {
    it('should create a valid handoff event with all required fields', () => {
      const handoff = createSpecialistHandoff(
        'review-agent',
        'test-agent',
        'PAN-123',
        'high',
        {
          workspace: 'feature-pan-123',
          branch: 'feature/pan-123',
          prUrl: 'https://github.com/org/repo/pull/123',
          source: 'review-completion',
        }
      );

      expect(handoff.id).toBeDefined();
      expect(handoff.id).toContain('test-agent');
      expect(handoff.id).toContain('PAN-123');
      expect(handoff.timestamp).toBeDefined();
      expect(handoff.issueId).toBe('PAN-123');
      expect(handoff.fromSpecialist).toBe('review-agent');
      expect(handoff.toSpecialist).toBe('test-agent');
      expect(handoff.status).toBe('queued');
      expect(handoff.priority).toBe('high');
      expect(handoff.context?.workspace).toBe('feature-pan-123');
      expect(handoff.context?.branch).toBe('feature/pan-123');
      expect(handoff.context?.prUrl).toBe('https://github.com/org/repo/pull/123');
      expect(handoff.context?.source).toBe('review-completion');
    });

    it('should create a handoff without context', () => {
      const handoff = createSpecialistHandoff(
        'issue-agent',
        'review-agent',
        'PAN-456',
        'normal'
      );

      expect(handoff.issueId).toBe('PAN-456');
      expect(handoff.priority).toBe('normal');
      expect(handoff.context).toBeUndefined();
    });

    it('should generate unique IDs with timestamp component', () => {
      const handoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');

      // Wait 1ms to ensure different timestamp
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      return delay(2).then(() => {
        const handoff2 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
        expect(handoff1.id).not.toBe(handoff2.id);
      });
    });
  });

  describe('logSpecialistHandoff', () => {
    it('should create log directory if it does not exist', () => {
      // Remove log directory if it exists
      if (existsSync(TEST_LOG_FILE)) {
        unlinkSync(TEST_LOG_FILE);
      }

      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-123', 'normal');
      logSpecialistHandoff(handoff);

      expect(existsSync(TEST_LOG_DIR)).toBe(true);
      expect(existsSync(TEST_LOG_FILE)).toBe(true);
    });

    it('should write handoff event to JSONL file', () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-123', 'normal');
      logSpecialistHandoff(handoff);

      const content = readFileSync(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);

      const logged = JSON.parse(lines[0]);
      expect(logged.id).toBe(handoff.id);
      expect(logged.issueId).toBe('PAN-123');
      expect(logged.fromSpecialist).toBe('review-agent');
      expect(logged.toSpecialist).toBe('test-agent');
    });

    it('should append multiple handoff events', () => {
      const handoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      const handoff2 = createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-2', 'urgent');
      const handoff3 = createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-3', 'high');

      logSpecialistHandoff(handoff1);
      logSpecialistHandoff(handoff2);
      logSpecialistHandoff(handoff3);

      const content = readFileSync(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).issueId).toBe('PAN-1');
      expect(JSON.parse(lines[1]).issueId).toBe('PAN-2');
      expect(JSON.parse(lines[2]).issueId).toBe('PAN-3');
    });
  });

  describe('readSpecialistHandoffs', () => {
    it('should return empty array when log file does not exist', () => {
      const handoffs = readSpecialistHandoffs();
      expect(handoffs).toEqual([]);
    });

    it('should return all handoffs in reverse chronological order', () => {
      const handoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      const handoff2 = createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-2', 'urgent');
      const handoff3 = createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-3', 'high');

      logSpecialistHandoff(handoff1);
      logSpecialistHandoff(handoff2);
      logSpecialistHandoff(handoff3);

      const handoffs = readSpecialistHandoffs();

      expect(handoffs).toHaveLength(3);
      // Most recent first
      expect(handoffs[0].issueId).toBe('PAN-3');
      expect(handoffs[1].issueId).toBe('PAN-2');
      expect(handoffs[2].issueId).toBe('PAN-1');
    });

    it('should respect limit parameter', () => {
      for (let i = 1; i <= 10; i++) {
        const handoff = createSpecialistHandoff('review-agent', 'test-agent', `PAN-${i}`, 'normal');
        logSpecialistHandoff(handoff);
      }

      const handoffs = readSpecialistHandoffs(5);
      expect(handoffs).toHaveLength(5);
      // Should get the 5 most recent
      expect(handoffs[0].issueId).toBe('PAN-10');
      expect(handoffs[4].issueId).toBe('PAN-6');
    });

    it('should handle empty lines in log file', () => {
      const handoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      const handoff2 = createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-2', 'urgent');

      logSpecialistHandoff(handoff1);
      // Manually add empty lines
      writeFileSync(TEST_LOG_FILE, readFileSync(TEST_LOG_FILE, 'utf-8') + '\n\n', 'utf-8');
      logSpecialistHandoff(handoff2);

      const handoffs = readSpecialistHandoffs();
      expect(handoffs).toHaveLength(2);
    });

    it('should handle corrupted JSON gracefully', () => {
      // Write valid handoff
      const validHandoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      logSpecialistHandoff(validHandoff);

      // Append corrupted JSON
      writeFileSync(
        TEST_LOG_FILE,
        readFileSync(TEST_LOG_FILE, 'utf-8') + '{invalid json\n',
        'utf-8'
      );

      // Write another valid handoff
      const validHandoff2 = createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-2', 'urgent');
      logSpecialistHandoff(validHandoff2);

      // Should throw when encountering corrupted JSON
      expect(() => readSpecialistHandoffs()).toThrow();
    });
  });

  describe('readIssueSpecialistHandoffs', () => {
    beforeEach(() => {
      // Create multiple handoffs for different issues
      const handoffs = [
        createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-123', 'normal'),
        createSpecialistHandoff('review-agent', 'test-agent', 'PAN-123', 'high'),
        createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-123', 'urgent'),
        createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-456', 'normal'),
        createSpecialistHandoff('review-agent', 'test-agent', 'PAN-456', 'normal'),
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));
    });

    it('should return handoffs for specific issue only', () => {
      const handoffs = readIssueSpecialistHandoffs('PAN-123');

      expect(handoffs).toHaveLength(3);
      handoffs.forEach(h => {
        expect(h.issueId).toBe('PAN-123');
      });
    });

    it('should return handoffs in reverse chronological order', () => {
      const handoffs = readIssueSpecialistHandoffs('PAN-123');

      expect(handoffs).toHaveLength(3);
      expect(handoffs[0].toSpecialist).toBe('merge-agent'); // Most recent
      expect(handoffs[1].toSpecialist).toBe('test-agent');
      expect(handoffs[2].toSpecialist).toBe('review-agent'); // Oldest
    });

    it('should return empty array for non-existent issue', () => {
      const handoffs = readIssueSpecialistHandoffs('PAN-999');
      expect(handoffs).toEqual([]);
    });

    it('should return empty array when log file does not exist', () => {
      unlinkSync(TEST_LOG_FILE);
      const handoffs = readIssueSpecialistHandoffs('PAN-123');
      expect(handoffs).toEqual([]);
    });
  });

  describe('getSpecialistHandoffStats', () => {
    it('should return zero stats for empty log', () => {
      const stats = getSpecialistHandoffStats();

      expect(stats.totalHandoffs).toBe(0);
      expect(stats.todayCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.queueDepth).toBe(0);
      expect(Object.keys(stats.bySpecialist)).toHaveLength(0);
      expect(Object.keys(stats.byStatus)).toHaveLength(0);
    });

    it('should count total handoffs', () => {
      for (let i = 1; i <= 5; i++) {
        const handoff = createSpecialistHandoff('review-agent', 'test-agent', `PAN-${i}`, 'normal');
        logSpecialistHandoff(handoff);
      }

      const stats = getSpecialistHandoffStats();
      expect(stats.totalHandoffs).toBe(5);
    });

    it('should count handoffs by specialist (sent and received)', () => {
      const handoffs = [
        createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-1', 'normal'),
        createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'high'),
        createSpecialistHandoff('review-agent', 'merge-agent', 'PAN-3', 'urgent'),
        createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-4', 'normal'),
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = getSpecialistHandoffStats();

      // review-agent: sent 2, received 1
      expect(stats.bySpecialist['review-agent'].sent).toBe(2);
      expect(stats.bySpecialist['review-agent'].received).toBe(1);

      // test-agent: sent 1, received 1
      expect(stats.bySpecialist['test-agent'].sent).toBe(1);
      expect(stats.bySpecialist['test-agent'].received).toBe(1);

      // merge-agent: sent 0, received 2
      expect(stats.bySpecialist['merge-agent'].sent).toBe(0);
      expect(stats.bySpecialist['merge-agent'].received).toBe(2);

      // issue-agent: sent 1, received 0
      expect(stats.bySpecialist['issue-agent'].sent).toBe(1);
      expect(stats.bySpecialist['issue-agent'].received).toBe(0);
    });

    it('should count handoffs by status', () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'processing' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-4', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-5', 'normal'), status: 'failed' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = getSpecialistHandoffStats();

      expect(stats.byStatus['queued']).toBe(1);
      expect(stats.byStatus['processing']).toBe(1);
      expect(stats.byStatus['completed']).toBe(2);
      expect(stats.byStatus['failed']).toBe(1);
    });

    it('should calculate success rate correctly', () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-4', 'normal'), status: 'failed' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = getSpecialistHandoffStats();

      // 3 successes out of 4 completed
      expect(stats.successRate).toBe(0.75);
    });

    it('should not count queued/processing items in success rate', () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'processing' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = getSpecialistHandoffStats();

      // Only 1 completed, 1 success = 100%
      expect(stats.successRate).toBe(1.0);
    });

    it('should calculate queue depth (queued + processing)', () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'processing' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-4', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-5', 'normal'), status: 'failed' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = getSpecialistHandoffStats();

      // 2 queued + 1 processing = 3
      expect(stats.queueDepth).toBe(3);
    });

    it('should count today\'s handoffs correctly', () => {
      // Create handoffs with today's timestamp
      const todayHandoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      const todayHandoff2 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal');

      logSpecialistHandoff(todayHandoff1);
      logSpecialistHandoff(todayHandoff2);

      // Create handoff with yesterday's timestamp
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayHandoff = {
        ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'),
        timestamp: yesterday.toISOString(),
      };
      logSpecialistHandoff(yesterdayHandoff);

      const stats = getSpecialistHandoffStats();

      expect(stats.totalHandoffs).toBe(3);
      expect(stats.todayCount).toBe(2);
    });
  });

  describe('getTodaySpecialistHandoffs', () => {
    it('should return empty array when log file does not exist', () => {
      const handoffs = getTodaySpecialistHandoffs();
      expect(handoffs).toEqual([]);
    });

    it('should return only handoffs from today', () => {
      // Today's handoffs
      const todayHandoff1 = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      const todayHandoff2 = createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-2', 'urgent');

      logSpecialistHandoff(todayHandoff1);
      logSpecialistHandoff(todayHandoff2);

      // Yesterday's handoff
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayHandoff = {
        ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'),
        timestamp: yesterday.toISOString(),
      };
      logSpecialistHandoff(yesterdayHandoff);

      const handoffs = getTodaySpecialistHandoffs();

      expect(handoffs).toHaveLength(2);
      expect(handoffs[0].issueId).toBe('PAN-2'); // Most recent first
      expect(handoffs[1].issueId).toBe('PAN-1');
    });

    it('should return empty array when no handoffs from today', () => {
      // Create handoff from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayHandoff = {
        ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'),
        timestamp: yesterday.toISOString(),
      };
      logSpecialistHandoff(yesterdayHandoff);

      const handoffs = getTodaySpecialistHandoffs();
      expect(handoffs).toEqual([]);
    });

    it('should handle handoffs at midnight boundary', () => {
      // Create timestamp for today at midnight UTC
      const today = new Date().toISOString().split('T')[0];
      const midnightTimestamp = `${today}T00:00:00.000Z`;

      const midnightHandoff = {
        ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'),
        timestamp: midnightTimestamp,
      };
      logSpecialistHandoff(midnightHandoff);

      const handoffs = getTodaySpecialistHandoffs();
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].timestamp).toBe(midnightTimestamp);
    });
  });
});
