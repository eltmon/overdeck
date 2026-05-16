/**
 * God View tests (PAN-341, updated PAN-433)
 *
 * Tests cover pure-logic units that don't require external packages:
 * - useGodViewStore (system health, focus state)
 * - GodView selector functions (agent output, statuses, activity from DashboardStore)
 * - ANSI parsing logic (CanvasTerminal internals)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ─── useGodViewStore (reduced — agent data now lives in DashboardStore) ───────

import { useGodViewStore, selectGodViewAgentOutput, selectGodViewAgentStatuses, selectGodViewActivityFeed } from '../../../hooks/useGodViewSocket';
import { selectIssueActivityFeed } from '../ActivityFeed';

describe('useGodViewStore', () => {
  beforeEach(() => {
    useGodViewStore.setState({
      systemHealth: null,
      focusedAgentId: null,
    });
  });

  it('setSystemHealth stores health data', () => {
    const health = { cpu: 45.5, memPercent: 62.3, memUsed: 8589934592, memTotal: 17179869184 };
    useGodViewStore.getState().setSystemHealth(health);
    expect(useGodViewStore.getState().systemHealth).toEqual(health);
  });

  it('setSystemHealth accepts null (clear)', () => {
    const health = { cpu: 10, memPercent: 50, memUsed: 1000, memTotal: 2000 };
    useGodViewStore.getState().setSystemHealth(health);
    useGodViewStore.getState().setSystemHealth(null);
    expect(useGodViewStore.getState().systemHealth).toBeNull();
  });

  it('setFocusedAgentId stores focused agent', () => {
    useGodViewStore.getState().setFocusedAgentId('agent-42');
    expect(useGodViewStore.getState().focusedAgentId).toBe('agent-42');
  });

  it('setFocusedAgentId clears focused agent', () => {
    useGodViewStore.getState().setFocusedAgentId('agent-42');
    useGodViewStore.getState().setFocusedAgentId(null);
    expect(useGodViewStore.getState().focusedAgentId).toBeNull();
  });
});

// ─── GodView selectors (read from DashboardStore) ────────────────────────────

describe('GodView selectors', () => {
  it('selectGodViewAgentOutput returns agentOutputById', () => {
    const state = { agentOutputById: { 'a1': ['line1'], 'a2': ['line2'] } };
    expect(selectGodViewAgentOutput(state)).toEqual({ 'a1': ['line1'], 'a2': ['line2'] });
  });

  it('selectGodViewAgentStatuses extracts status from agentsById', () => {
    const state = { agentsById: { 'a1': { status: 'running' }, 'a2': { status: 'stopped' } } };
    expect(selectGodViewAgentStatuses(state)).toEqual({ 'a1': 'running', 'a2': 'stopped' });
  });

  it('selectGodViewActivityFeed returns recentActivity', () => {
    const events = [{ id: 'evt-1', timestamp: 'T', source: 'cloister', level: 'info', message: 'y' }];
    expect(selectGodViewActivityFeed({ recentActivity: events })).toEqual(events);
  });

  it('selectGodViewActivityFeed includes memory observations in timestamp order', () => {
    const state = {
      recentActivity: [{ agentId: 'a', timestamp: '2026-05-16T20:00:00.000Z', type: 'x', message: 'older' }],
      observationsByIssueId: {
        'PAN-1052': [{
          id: 'obs-1',
          timestamp: '2026-05-16T20:01:00.000Z',
          projectId: 'panopticon-cli',
          workspaceId: 'feature-pan-1052',
          issueId: 'PAN-1052',
          runId: 'run-1',
          sessionId: 'session-1',
          agentRole: 'work',
          agentHarness: 'claude-code',
          gitBranch: 'feature/pan-1052',
          sourceTranscriptOffset: 1,
          actionStatus: 'Wired memory observation stream',
          narrative: 'Memory observation events update the sidebar feed.',
          summary: 'Memory observation stream updates sidebar.',
          files: [],
          tags: [],
          tokens: { prompt: 1, completion: 1, total: 2 },
          model: 'stub-model',
        }],
      },
    } as const;

    expect(selectGodViewActivityFeed(state)[0]).toMatchObject({
      agentId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      message: 'Wired memory observation stream',
    });
  });

  it('selectIssueActivityFeed filters to the matching issueId', () => {
    const events = [
      { agentId: 'agent-pan-866', issueId: 'PAN-866', timestamp: 'T1', type: 'x', message: 'match' },
      { agentId: 'agent-pan-777', issueId: 'PAN-777', timestamp: 'T2', type: 'x', message: 'other' },
    ];
    expect(selectIssueActivityFeed('PAN-866')({ recentActivity: events } as any)).toEqual([events[0]]);
  });

  it('selectIssueActivityFeed falls back to agentId matching when issueId is absent', () => {
    const events = [
      { agentId: 'agent-pan-866', timestamp: 'T1', type: 'x', message: 'match' },
      { agentId: 'agent-pan-777', timestamp: 'T2', type: 'x', message: 'other' },
    ];
    expect(selectIssueActivityFeed('PAN-866')({ recentActivity: events } as any)).toEqual([events[0]]);
  });
});

// ─── ANSI parsing logic (CanvasTerminal internals) ────────────────────────────

// These functions are extracted verbatim from CanvasTerminal.tsx for unit testing

const ANSI_COLORS: Record<string, string> = {
  '30': '#4a5568', '31': '#ff2d7c', '32': '#39ff14', '33': '#ffb800',
  '34': '#00d4ff', '35': '#9d4edd', '36': '#00d4ff', '37': '#e8edf8',
  '90': '#7a8aaa', '91': '#ff6b9d', '92': '#7eff6b', '93': '#ffd066',
  '94': '#6bdaff', '95': '#c07ef0', '96': '#6bdaff', '97': '#ffffff',
};
const ANSI_RESET = '#e8edf8';
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

interface TextSegment { text: string; color: string; bold: boolean; }

function parseAnsiLine(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentColor = ANSI_RESET;
  let currentBold = false;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: raw.slice(lastIndex, match.index), color: currentColor, bold: currentBold });
    }
    lastIndex = match.index + match[0].length;
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) { currentColor = ANSI_RESET; currentBold = false; }
      else if (code === 1) { currentBold = true; }
      else if (code === 22) { currentBold = false; }
      else if (ANSI_COLORS[String(code)]) { currentColor = ANSI_COLORS[String(code)]; }
    }
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex), color: currentColor, bold: currentBold });
  }
  return segments;
}

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ANSI parsing (CanvasTerminal logic)', () => {
  it('returns plain text as a single segment with default color', () => {
    const segments = parseAnsiLine('hello world');
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('hello world');
    expect(segments[0].color).toBe(ANSI_RESET);
    expect(segments[0].bold).toBe(false);
  });

  it('parses green text \\x1b[32m', () => {
    const segments = parseAnsiLine('\x1b[32mgreen text\x1b[0m');
    const greenSeg = segments.find(s => s.text === 'green text');
    expect(greenSeg).toBeDefined();
    expect(greenSeg!.color).toBe('#39ff14');
  });

  it('parses bold \\x1b[1m', () => {
    const segments = parseAnsiLine('\x1b[1mbold text\x1b[0m');
    const boldSeg = segments.find(s => s.text === 'bold text');
    expect(boldSeg).toBeDefined();
    expect(boldSeg!.bold).toBe(true);
  });

  it('resets color and bold on \\x1b[0m', () => {
    const segments = parseAnsiLine('\x1b[1m\x1b[32mbold green\x1b[0mplain');
    const plainSeg = segments.find(s => s.text === 'plain');
    expect(plainSeg).toBeDefined();
    expect(plainSeg!.bold).toBe(false);
    expect(plainSeg!.color).toBe(ANSI_RESET);
  });

  it('handles text with no ANSI codes', () => {
    const segments = parseAnsiLine('no codes here');
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('no codes here');
  });

  it('handles empty string', () => {
    const segments = parseAnsiLine('');
    expect(segments).toHaveLength(0);
  });

  it('code comparison is number-only — no string empty-check (type bug regression)', () => {
    // Regression: codes.map(Number) produces number[] so code is always a number.
    // The old code had `code === ''` which is always false since typeof code === 'number'.
    const codes = '0;1;32'.split(';').map(Number);
    expect(codes.every(c => typeof c === 'number')).toBe(true);
    // Verify code === 0 triggers reset correctly (not shadowed by dead string comparison)
    const segments = parseAnsiLine('\x1b[32mcolored\x1b[0mplain');
    const plain = segments.find(s => s.text === 'plain');
    expect(plain?.color).toBe(ANSI_RESET);
    expect(plain?.bold).toBe(false);
  });

  it('handles multiple color codes in sequence', () => {
    const segments = parseAnsiLine('\x1b[31mred\x1b[32mgreen\x1b[0m');
    const redSeg = segments.find(s => s.text === 'red');
    const greenSeg = segments.find(s => s.text === 'green');
    expect(redSeg?.color).toBe('#ff2d7c');
    expect(greenSeg?.color).toBe('#39ff14');
  });
});

describe('stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
    expect(stripAnsi('\x1b[1m\x1b[33mwarning\x1b[0m!')).toBe('warning!');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('removes multiple sequential codes', () => {
    expect(stripAnsi('\x1b[1m\x1b[32m\x1b[4mbold-green-underline\x1b[0m')).toBe('bold-green-underline');
  });
});

// ─── Activity aggregation logic ───────────────────────────────────────────────

describe('God View activity aggregation', () => {
  it('deduplicates events by id', () => {
    const events = [
      { id: 'evt-1', source: 'cloister', level: 'info', timestamp: '2026-01-01T10:00:00Z', message: 'x' },
      { id: 'evt-1', source: 'cloister', level: 'info', timestamp: '2026-01-01T10:00:00Z', message: 'x' },
      { id: 'evt-2', source: 'review-specialist', level: 'success', timestamp: '2026-01-01T10:01:00Z', message: 'y' },
    ];
    const byId = new Map<string, typeof events[number]>();
    for (const event of events) byId.set(event.id, event);
    const unique = Array.from(byId.values());
    expect(unique).toHaveLength(2);
    expect(unique[0].id).toBe('evt-1');
    expect(unique[1].id).toBe('evt-2');
  });

  it('sorts events newest-first', () => {
    const events = [
      { id: 'evt-1', source: 'cloister', level: 'info', timestamp: '2026-01-01T09:00:00Z', message: 'old' },
      { id: 'evt-2', source: 'merge-agent', level: 'success', timestamp: '2026-01-01T11:00:00Z', message: 'newest' },
      { id: 'evt-3', source: 'test-specialist', level: 'warn', timestamp: '2026-01-01T10:00:00Z', message: 'middle' },
    ];
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    expect(events[0].message).toBe('newest');
    expect(events[1].message).toBe('middle');
    expect(events[2].message).toBe('old');
  });

  it('caps at 20 events', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      id: `evt-${i}`,
      source: 'cloister',
      level: 'info' as const,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      message: `event ${i}`,
    }));
    expect(events.slice(0, 20)).toHaveLength(20);
  });

  it('preserves event structure', () => {
    const event = { id: 'evt-9', source: 'merge-agent', level: 'success', timestamp: '2026-01-01T10:00:00Z', message: 'feat: add thing', issueId: 'PAN-123' };
    const feed = [event];
    expect(feed[0]).toHaveProperty('id', 'evt-9');
    expect(feed[0]).toHaveProperty('source', 'merge-agent');
    expect(feed[0]).toHaveProperty('level', 'success');
    expect(feed[0]).toHaveProperty('message', 'feat: add thing');
    expect(feed[0]).toHaveProperty('issueId', 'PAN-123');
  });
});

// ─── Connection lines grouping logic ─────────────────────────────────────────

describe('ConnectionLines grouping logic', () => {
  function groupByIssuePrefix(agents: Array<{ id: string; issueId?: string }>) {
    const groups = new Map<string, typeof agents>();
    for (const agent of agents) {
      if (!agent.issueId) continue;
      const prefix = agent.issueId.replace(/-\d+$/, '');
      const group = groups.get(prefix) || [];
      group.push(agent);
      groups.set(prefix, group);
    }
    return groups;
  }

  it('groups agents by issue prefix', () => {
    const agents = [
      { id: 'a1', issueId: 'PAN-341' },
      { id: 'a2', issueId: 'PAN-341' },
      { id: 'a3', issueId: 'PAN-342' },
    ];
    const groups = groupByIssuePrefix(agents);
    expect(groups.get('PAN')?.length).toBe(3);
  });

  it('ignores agents without issueId', () => {
    const agents = [
      { id: 'a1' },
      { id: 'a2', issueId: 'PAN-341' },
    ];
    const groups = groupByIssuePrefix(agents);
    expect(groups.get('PAN')?.length).toBe(1);
  });

  it('returns empty map for no agents', () => {
    const groups = groupByIssuePrefix([]);
    expect(groups.size).toBe(0);
  });

  it('multiple issues create separate groups', () => {
    const agents = [
      { id: 'a1', issueId: 'PAN-100' },
      { id: 'a2', issueId: 'MIN-200' },
    ];
    const groups = groupByIssuePrefix(agents);
    expect(groups.get('PAN')?.length).toBe(1);
    expect(groups.get('MIN')?.length).toBe(1);
  });
});
