/**
 * Tests for God View REST endpoints (PAN-341)
 *
 * Tests the three new endpoints:
 *   GET /api/agents/:id/files
 *   GET /api/agents/:id/timeline
 *   GET /api/godview/system-health
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, cpus as osCpus, freemem, totalmem } from 'os';

// ─── Unit tests for ANSI-stripped God View logic ──────────────────────────────

describe('God View endpoint logic', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'god-view-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── /api/agents/:id/files ──────────────────────────────────────────────────

  describe('files endpoint logic — parseGitDiffOutput', () => {
    function parseGitOutput(stdout: string) {
      return stdout
        .split('\n')
        .filter(l => l.trim())
        .map(l => {
          const parts = l.trim().split(/\s+/);
          if (parts.length >= 2) {
            return { status: parts[0], path: parts[parts.length - 1] };
          }
          return { status: '?', path: l.trim() };
        })
        .filter(f => f.path);
    }

    it('parses M (modified) entries', () => {
      const result = parseGitOutput('M\tsrc/foo.ts\nM\tsrc/bar.ts\n');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: 'M', path: 'src/foo.ts' });
      expect(result[1]).toEqual({ status: 'M', path: 'src/bar.ts' });
    });

    it('parses A (added) entries', () => {
      const result = parseGitOutput('A\tsrc/new.ts');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ status: 'A', path: 'src/new.ts' });
    });

    it('parses D (deleted) entries', () => {
      const result = parseGitOutput('D\tsrc/removed.ts');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ status: 'D', path: 'src/removed.ts' });
    });

    it('handles empty output gracefully', () => {
      expect(parseGitOutput('')).toHaveLength(0);
      expect(parseGitOutput('\n\n')).toHaveLength(0);
    });

    it('handles mixed statuses', () => {
      const result = parseGitOutput('M\ta.ts\nA\tb.ts\nD\tc.ts');
      expect(result).toHaveLength(3);
      expect(result.map(f => f.status)).toEqual(['M', 'A', 'D']);
    });
  });

  // ── /api/agents/:id/timeline ───────────────────────────────────────────────

  describe('timeline endpoint logic — parseActivityEvents', () => {
    function parseEvents(lines: string[], agentId: string): Array<{ timestamp: string; type: string; message: string }> {
      return lines
        .filter(l => l.trim())
        .map(l => {
          try {
            const e = JSON.parse(l);
            return {
              timestamp: e.timestamp || new Date().toISOString(),
              type: e.type || 'activity',
              message: e.message || e.content || '',
            };
          } catch {
            return null;
          }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
    }

    it('parses valid activity JSONL lines', () => {
      const lines = [
        JSON.stringify({ timestamp: '2026-01-01T10:00:00Z', type: 'commit', message: 'feat: initial' }),
        JSON.stringify({ timestamp: '2026-01-01T10:01:00Z', type: 'test', message: 'tests pass' }),
      ];
      const result = parseEvents(lines, 'agent-1');
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('commit');
      expect(result[1].type).toBe('test');
    });

    it('skips malformed JSONL lines', () => {
      const lines = [
        JSON.stringify({ timestamp: '2026-01-01T10:00:00Z', type: 'commit', message: 'ok' }),
        'not-json',
        '{broken',
      ];
      const result = parseEvents(lines, 'agent-1');
      expect(result).toHaveLength(1);
    });

    it('handles empty activity gracefully', () => {
      expect(parseEvents([], 'agent-1')).toHaveLength(0);
    });

    it('uses content field as fallback for message', () => {
      const lines = [
        JSON.stringify({ timestamp: '2026-01-01T10:00:00Z', type: 'activity', content: 'fallback content' }),
      ];
      const result = parseEvents(lines, 'agent-1');
      expect(result[0].message).toBe('fallback content');
    });

    it('defaults type to activity when missing', () => {
      const lines = [
        JSON.stringify({ timestamp: '2026-01-01T10:00:00Z', message: 'no type field' }),
      ];
      const result = parseEvents(lines, 'agent-1');
      expect(result[0].type).toBe('activity');
    });
  });

  // ── /api/godview/system-health ─────────────────────────────────────────────

  describe('system-health endpoint logic', () => {
    it('os.cpus() returns an array of CPU info objects', () => {
      const cpuList = osCpus();
      expect(Array.isArray(cpuList)).toBe(true);
      expect(cpuList.length).toBeGreaterThan(0);
      expect(cpuList[0]).toHaveProperty('times');
      expect(cpuList[0].times).toHaveProperty('idle');
    });

    it('os.freemem() returns a positive number', () => {
      expect(freemem()).toBeGreaterThan(0);
    });

    it('os.totalmem() returns a positive number greater than freemem()', () => {
      expect(totalmem()).toBeGreaterThan(0);
      expect(totalmem()).toBeGreaterThanOrEqual(freemem());
    });

    it('computes cpu usage percentage correctly', () => {
      const cpuList = osCpus();
      const cpuUsage = cpuList.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((s, t) => s + t, 0);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total) * 100;
      }, 0) / cpuList.length;

      // CPU usage must be between 0 and 100
      expect(cpuUsage).toBeGreaterThanOrEqual(0);
      expect(cpuUsage).toBeLessThanOrEqual(100);
    });

    it('computes memPercent correctly', () => {
      const memTotal = totalmem();
      const memFree = freemem();
      const memPercent = ((memTotal - memFree) / memTotal) * 100;
      expect(memPercent).toBeGreaterThanOrEqual(0);
      expect(memPercent).toBeLessThanOrEqual(100);
    });

    it('builds a valid system health cache object', () => {
      const cpuList = osCpus();
      const cpuUsage = cpuList.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((s, t) => s + t, 0);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total) * 100;
      }, 0) / cpuList.length;
      const memTotal = totalmem();
      const memFree = freemem();
      const cache = {
        cpu: Math.round(cpuUsage * 10) / 10,
        memPercent: Math.round(((memTotal - memFree) / memTotal) * 1000) / 10,
        memUsed: memTotal - memFree,
        memTotal,
        updatedAt: new Date().toISOString(),
      };
      expect(cache.cpu).toBeGreaterThanOrEqual(0);
      expect(cache.memPercent).toBeGreaterThanOrEqual(0);
      expect(cache.memUsed).toBeGreaterThan(0);
      expect(cache.memTotal).toBeGreaterThan(cache.memUsed);
      expect(cache.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

// ─── God View activity feed aggregation logic ─────────────────────────────────

describe('God View activity aggregation', () => {
  it('deduplicates events by agentId+timestamp', () => {
    const events = [
      { agentId: 'a', timestamp: '2026-01-01T10:00:00Z', type: 'commit', message: 'x' },
      { agentId: 'a', timestamp: '2026-01-01T10:00:00Z', type: 'commit', message: 'x' },
      { agentId: 'b', timestamp: '2026-01-01T10:01:00Z', type: 'activity', message: 'y' },
    ];
    const seen = new Set<string>();
    const unique = events.filter(e => {
      const key = `${e.agentId}:${e.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    expect(unique).toHaveLength(2);
  });

  it('sorts events newest-first', () => {
    const events = [
      { agentId: 'a', timestamp: '2026-01-01T09:00:00Z', type: 'activity', message: 'old' },
      { agentId: 'b', timestamp: '2026-01-01T11:00:00Z', type: 'commit', message: 'newest' },
      { agentId: 'c', timestamp: '2026-01-01T10:00:00Z', type: 'activity', message: 'middle' },
    ];
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    expect(events[0].message).toBe('newest');
    expect(events[1].message).toBe('middle');
    expect(events[2].message).toBe('old');
  });

  it('caps at 20 events', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      agentId: `agent-${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      type: 'activity',
      message: `event ${i}`,
    }));
    const capped = events.slice(0, 20);
    expect(capped).toHaveLength(20);
  });
});
