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
  updateSpecialistHandoffStatus,
} from '../../../src/lib/cloister/specialist-handoff-logger.js';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPanopticonHome } from '../../../src/lib/paths.js';

function getTestLogFile(): string {
  return join(getPanopticonHome(), 'logs', 'specialist-handoffs.jsonl');
}

function getTestLogDir(): string {
  return join(getPanopticonHome(), 'logs');
}

// Isolated temp directory for hook files — prevents tests from reading real AGENTS_DIR
let TEST_AGENTS_DIR: string;

describe('specialist-handoff-logger', () => {
  beforeEach(() => {
    // Clean up test log file
    if (existsSync(getTestLogFile())) {
      unlinkSync(getTestLogFile());
    }
    // Create a fresh temp agents dir for each test
    TEST_AGENTS_DIR = join(tmpdir(), `pan-test-agents-${Date.now()}`);
    mkdirSync(TEST_AGENTS_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(getTestLogFile())) {
      unlinkSync(getTestLogFile());
    }
    // Remove temp agents dir
    rmSync(TEST_AGENTS_DIR, { recursive: true, force: true });
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
      if (existsSync(getTestLogFile())) {
        unlinkSync(getTestLogFile());
      }

      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-123', 'normal');
      logSpecialistHandoff(handoff);

      expect(existsSync(getTestLogDir())).toBe(true);
      expect(existsSync(getTestLogFile())).toBe(true);
    });

    it('should write handoff event to JSONL file', () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-123', 'normal');
      logSpecialistHandoff(handoff);

      const content = readFileSync(getTestLogFile(), 'utf-8');
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

      const content = readFileSync(getTestLogFile(), 'utf-8');
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
      writeFileSync(getTestLogFile(), readFileSync(getTestLogFile(), 'utf-8') + '\n\n', 'utf-8');
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
        getTestLogFile(),
        readFileSync(getTestLogFile(), 'utf-8') + '{invalid json\n',
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
      unlinkSync(getTestLogFile());
      const handoffs = readIssueSpecialistHandoffs('PAN-123');
      expect(handoffs).toEqual([]);
    });
  });

  describe('getSpecialistHandoffStats', () => {
    it('should return zero stats for empty log', async () => {
      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

      expect(stats.totalHandoffs).toBe(0);
      expect(stats.todayCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.queueDepth).toBe(0);
      expect(Object.keys(stats.bySpecialist)).toHaveLength(0);
      expect(Object.keys(stats.byStatus)).toHaveLength(0);
    });

    it('should count total handoffs', async () => {
      for (let i = 1; i <= 5; i++) {
        const handoff = createSpecialistHandoff('review-agent', 'test-agent', `PAN-${i}`, 'normal');
        logSpecialistHandoff(handoff);
      }

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });
      expect(stats.totalHandoffs).toBe(5);
    });

    it('should count handoffs by specialist (sent and received)', async () => {
      const handoffs = [
        createSpecialistHandoff('issue-agent', 'review-agent', 'PAN-1', 'normal'),
        createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'high'),
        createSpecialistHandoff('review-agent', 'merge-agent', 'PAN-3', 'urgent'),
        createSpecialistHandoff('test-agent', 'merge-agent', 'PAN-4', 'normal'),
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

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

    it('should count handoffs by status', async () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'processing' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-4', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-5', 'normal'), status: 'failed' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

      expect(stats.byStatus['queued']).toBe(1);
      expect(stats.byStatus['processing']).toBe(1);
      expect(stats.byStatus['completed']).toBe(2);
      expect(stats.byStatus['failed']).toBe(1);
    });

    it('should calculate success rate correctly', async () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-4', 'normal'), status: 'failed' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

      // 3 successes out of 4 completed
      expect(stats.successRate).toBe(0.75);
    });

    it('should not count queued/processing items in success rate', async () => {
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'processing' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'completed' as const, result: 'success' as const },
      ];

      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

      // Only 1 completed, 1 success = 100%
      expect(stats.successRate).toBe(1.0);
    });

    it('should always return queueDepth=0 (non-merge specialists have no queue)', async () => {
      // Log handoffs with queued/processing status — queueDepth is always 0 because
      // non-merge specialists dispatch immediately (PAN-722). Merge queue depth is
      // tracked separately via SQLite, not here.
      const handoffs = [
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-2', 'normal'), status: 'queued' as const },
        { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-3', 'normal'), status: 'processing' as const },
      ];
      handoffs.forEach(h => logSpecialistHandoff(h));

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });
      expect(stats.queueDepth).toBe(0);
    });

    it('should count today\'s handoffs correctly', async () => {
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

      const stats = await getSpecialistHandoffStats({ agentsDir: TEST_AGENTS_DIR });

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

  describe('updateSpecialistHandoffStatus', () => {
    it('should return false when log file does not exist', async () => {
      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(false);
    });

    it('should update the most recent matching queued record', async () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      logSpecialistHandoff(handoff);

      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(true);

      const handoffs = readSpecialistHandoffs();
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].status).toBe('completed');
      expect(handoffs[0].result).toBe('success');
    });

    it('should set completedAt timestamp when completing or failing', async () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      logSpecialistHandoff(handoff);

      const before = Date.now();
      await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      const after = Date.now();

      const handoffs = readSpecialistHandoffs();
      expect(handoffs[0].completedAt).toBeDefined();
      const completedAt = new Date(handoffs[0].completedAt!).getTime();
      expect(completedAt).toBeGreaterThanOrEqual(before);
      expect(completedAt).toBeLessThanOrEqual(after);
    });

    it('should not set completedAt when setting processing status', async () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      logSpecialistHandoff(handoff);

      await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'processing');

      const handoffs = readSpecialistHandoffs();
      expect(handoffs[0].status).toBe('processing');
      expect(handoffs[0].completedAt).toBeUndefined();
    });

    it('should return false when no matching active record exists', async () => {
      // Log a completed record — should not match (only queued/processing are updated)
      const handoff = {
        ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'),
        status: 'completed' as const,
        result: 'success' as const,
      };
      logSpecialistHandoff(handoff);

      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(false);
    });

    it('should return false when issueId does not match', async () => {
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      logSpecialistHandoff(handoff);

      const result = await updateSpecialistHandoffStatus('PAN-999', 'test-agent', 'completed', 'success');
      expect(result).toBe(false);

      // Original record unchanged
      const handoffs = readSpecialistHandoffs();
      expect(handoffs[0].status).toBe('queued');
    });

    it('should update most recent record when multiple exist for same issue', async () => {
      // Log two queued records for the same issue
      const first = { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), timestamp: '2026-01-01T10:00:00.000Z' };
      const second = { ...createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal'), timestamp: '2026-01-01T11:00:00.000Z' };
      logSpecialistHandoff(first);
      logSpecialistHandoff(second);

      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(true);

      // Only the most recent (second) should be updated
      const handoffs = readSpecialistHandoffs();
      expect(handoffs).toHaveLength(2);
      const firstRecord = handoffs.find(h => h.timestamp === '2026-01-01T10:00:00.000Z')!;
      const secondRecord = handoffs.find(h => h.timestamp === '2026-01-01T11:00:00.000Z')!;
      expect(firstRecord.status).toBe('queued');
      expect(secondRecord.status).toBe('completed');
    });

    it('should handle corrupted JSON lines gracefully', async () => {
      // Write a corrupted log file
      const logDir = getTestLogDir();
      mkdirSync(logDir, { recursive: true });
      const logFile = getTestLogFile();
      const handoff = createSpecialistHandoff('review-agent', 'test-agent', 'PAN-1', 'normal');
      writeFileSync(logFile, `{corrupted json}\n${JSON.stringify(handoff)}\n`, 'utf-8');

      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(true);

      const content = readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      // The valid line should be updated; corrupted line stays as-is
      expect(lines).toHaveLength(2);
      const updatedHandoff = JSON.parse(lines[1]);
      expect(updatedHandoff.status).toBe('completed');
    });

    it('should handle empty log file', async () => {
      const logDir = getTestLogDir();
      mkdirSync(logDir, { recursive: true });
      const logFile = getTestLogFile();
      writeFileSync(logFile, '', 'utf-8');

      const result = await updateSpecialistHandoffStatus('PAN-1', 'test-agent', 'completed', 'success');
      expect(result).toBe(false);
    });
  });
});
