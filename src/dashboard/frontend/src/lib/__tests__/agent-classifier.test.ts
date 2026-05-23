import { describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@panctl/contracts';
import {
  classifyDashboardAgent,
  ORPHAN_AGE_THRESHOLD_MS,
  ORPHAN_PREFIX_PATTERN,
} from '../agent-classifier';

const NOW_MS = Date.parse('2026-05-23T12:00:00.000Z');
const OLD_TIMESTAMP = new Date(NOW_MS - ORPHAN_AGE_THRESHOLD_MS - 1).toISOString();
const RECENT_TIMESTAMP = new Date(NOW_MS - ORPHAN_AGE_THRESHOLD_MS + 1).toISOString();

function agent(overrides: Partial<AgentSnapshot>): AgentSnapshot {
  return {
    id: 'agent-pan-1370',
    issueId: 'PAN-1370',
    status: 'stopped',
    startedAt: RECENT_TIMESTAMP,
    ...overrides,
  };
}

describe('classifyDashboardAgent', () => {
  it('returns active for PAN-1370 running with a live tmux session', () => {
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-1370', status: 'running', hasLiveTmuxSession: true }), NOW_MS)).toBe('active');
  });

  it('returns active when a stopped agent still has a live tmux session', () => {
    expect(classifyDashboardAgent(agent({ status: 'stopped', hasLiveTmuxSession: true, startedAt: OLD_TIMESTAMP }), NOW_MS)).toBe('active');
  });

  it('returns stopped for a recent stopped agent without a tmux session', () => {
    expect(classifyDashboardAgent(agent({ status: 'stopped', hasLiveTmuxSession: false, lastActivity: RECENT_TIMESTAMP }), NOW_MS)).toBe('stopped');
  });

  it('returns orphan_test for PAN-AC22 when the prefix matches and age exceeds seven days', () => {
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-AC22', status: 'stopped', hasLiveTmuxSession: false, lastActivity: OLD_TIMESTAMP }), NOW_MS)).toBe('orphan_test');
  });

  it('returns orphan_test for PAN-TEST-1 when the prefix matches and age exceeds seven days', () => {
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-TEST-1', status: 'stopped', hasLiveTmuxSession: false, startedAt: OLD_TIMESTAMP }), NOW_MS)).toBe('orphan_test');
  });

  it('returns stopped for a pipeline agent that stopped recently', () => {
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-SHIP-1', status: 'stopped', hasLiveTmuxSession: false, lastActivity: RECENT_TIMESTAMP }), NOW_MS)).toBe('stopped');
  });

  it('returns active for ambiguous tmux-unknown running agents', () => {
    expect(classifyDashboardAgent(agent({ status: 'running', hasLiveTmuxSession: undefined }), NOW_MS)).toBe('active');
  });

  it('does not use stale running status as active when tmux is known dead', () => {
    expect(classifyDashboardAgent(agent({ status: 'running', hasLiveTmuxSession: false }), NOW_MS)).toBe('stopped');
  });

  it('requires both orphan prefix and age threshold', () => {
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-1370', status: 'stopped', hasLiveTmuxSession: false, startedAt: OLD_TIMESTAMP }), NOW_MS)).toBe('stopped');
    expect(classifyDashboardAgent(agent({ issueId: 'PAN-REVIEW-1', status: 'stopped', hasLiveTmuxSession: false, startedAt: RECENT_TIMESTAMP }), NOW_MS)).toBe('stopped');
  });

  it('exports the orphan classifier constants', () => {
    expect(ORPHAN_PREFIX_PATTERN.test('PAN-PI-PROMPT-7')).toBe(true);
    expect(ORPHAN_AGE_THRESHOLD_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
