/**
 * Tests for cost-monitor.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the overdeck cost-sync door so checkCostLimits reads from controllable
// fakes rather than requiring a real SQLite database.
vi.mock('../../src/lib/overdeck/cost-sync.js', () => ({
  getAgentRollup:          vi.fn(() => []),
  getDailyTrendsSync:      vi.fn(() => []),
  getCostForIssue:     vi.fn(() => null),
  getAgentDailyCost:   vi.fn(() => 0),
}));

import {
  getAgentRollup,
  getDailyTrendsSync as getDailyTrends,
  getCostForIssue as getCostForIssueFromDb,
  getAgentDailyCost,
} from '../../src/lib/overdeck/cost-sync.js';
import { checkCostLimits } from '../../src/lib/cloister/cost-monitor.js';

describe('cost-monitor', () => {
  beforeEach(() => {
    // Reset DB mocks to default (no spend)
    vi.mocked(getAgentRollup).mockReturnValue([]);
    vi.mocked(getDailyTrends).mockReturnValue([]);
    vi.mocked(getCostForIssueFromDb).mockReturnValue(null);
    vi.mocked(getAgentDailyCost).mockReturnValue(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkCostLimits', () => {
    it('returns no alerts and reads no cost data when limits are not configured (opt-in, PAN-2642)', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(9999);
      const alerts = checkCostLimits('agent-1', 'pan-1', undefined);
      expect(alerts).toHaveLength(0);
      expect(getAgentDailyCost).not.toHaveBeenCalled();
      expect(getDailyTrends).not.toHaveBeenCalled();
    });

    it('skips unset limit dimensions and defaults the warn threshold to 0.8', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(9.0);
      const alerts = checkCostLimits('agent-1', undefined, { per_agent_usd: 10.0 });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ type: 'per_agent', level: 'warning' });
      expect(getDailyTrends).not.toHaveBeenCalled();
    });

    it('should not alert when under threshold', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(1.0);
      vi.mocked(getDailyTrends).mockReturnValue([
        { date: '2026-06-17', totalCost: 1.0, eventCount: 1, totalTokens: 100 },
      ]);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 10.0,
        per_issue_usd: 25.0,
        daily_total_usd: 100.0,
        alert_threshold: 0.8,
      });
      expect(alerts).toHaveLength(0);
    });

    it('should warn at 80% threshold for agent', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(8.0);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 10.0,
        per_issue_usd: 25.0,
        daily_total_usd: 100.0,
        alert_threshold: 0.8,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('per_agent');
      expect(alerts[0].level).toBe('warning');
      expect(alerts[0].agentId).toBe('agent-1');
      expect(alerts[0].percentUsed).toBe(80);
    });

    it('should alert at 100% limit for agent', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(10.0);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 10.0,
        per_issue_usd: 25.0,
        daily_total_usd: 100.0,
        alert_threshold: 0.8,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('per_agent');
      expect(alerts[0].level).toBe('limit_reached');
      expect(alerts[0].currentCost).toBe(10.0);
    });

    it('should warn for multiple limit types when exceeded', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(10.0);
      vi.mocked(getCostForIssueFromDb).mockReturnValue({
        issueId: 'issue-1',
        totalCost: 10.0,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        lastUpdated: '',
        budgetWarning: false,
        models: {},
        stages: {},
      });
      vi.mocked(getDailyTrends).mockReturnValue([
        { date: '2026-06-17', totalCost: 10.0, eventCount: 1, totalTokens: 100 },
      ]);

      const alerts = checkCostLimits('agent-1', 'issue-1', {
        per_agent_usd: 10.0,
        per_issue_usd: 10.0,
        daily_total_usd: 10.0,
        alert_threshold: 0.8,
      });

      expect(alerts.length).toBeGreaterThanOrEqual(3);
      expect(alerts.some(a => a.type === 'per_agent')).toBe(true);
      expect(alerts.some(a => a.type === 'per_issue')).toBe(true);
      expect(alerts.some(a => a.type === 'daily_total')).toBe(true);
    });

    it('should not check disabled limits (set to 0)', () => {
      vi.mocked(getAgentDailyCost).mockReturnValue(100.0);
      vi.mocked(getDailyTrends).mockReturnValue([
        { date: '2026-06-17', totalCost: 100.0, eventCount: 1, totalTokens: 0 },
      ]);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 0,
        per_issue_usd: 0,
        daily_total_usd: 0,
        alert_threshold: 0.8,
      });

      expect(alerts).toHaveLength(0);
    });
  });

  describe('PAN-2402: Cost limit accounting and attribution fixes', () => {
    describe('Attribution: daily_total alerts should have correct project bucket', () => {
      it('should generate daily_total alert without agentId or issueId', () => {
        vi.mocked(getDailyTrends).mockReturnValue([
          { date: '2026-07-06', totalCost: 100.0, eventCount: 5, totalTokens: 5000 },
        ]);
        const alerts = checkCostLimits('agent-1', undefined, {
          per_agent_usd: 10.0,
          per_issue_usd: 25.0,
          daily_total_usd: 100.0,
          alert_threshold: 0.8,
        });

        const dailyAlert = alerts.find(a => a.type === 'daily_total');
        expect(dailyAlert).toBeDefined();
        expect(dailyAlert?.agentId).toBeUndefined();
        expect(dailyAlert?.issueId).toBeUndefined();
        // The log should use "(unattributed)" bucket, not "undefined" - this is verified
        // in service.ts tests, but we ensure the alert has no attribution fields
      });
    });

    describe('Limit window: per-agent cap compares daily total, not lifetime total', () => {
      it('should scope per-agent limit to daily total (today only), not lifetime', () => {
        // Simulate an agent with $683 lifetime (causing the original 68× overrun issue)
        // but only $5 spent today
        vi.mocked(getAgentDailyCost).mockReturnValue(5.0);
        vi.mocked(getDailyTrends).mockReturnValue([
          { date: '2026-07-06', totalCost: 5.0, eventCount: 5, totalTokens: 1000 },
        ]);

        const alerts = checkCostLimits('flywheel-orchestrator', undefined, {
          per_agent_usd: 10.0,
          per_issue_usd: 25.0,
          daily_total_usd: 100.0,
          alert_threshold: 0.8,
        });

        // Should NOT alert because today's spend is $5, which is < $10 cap
        const perAgentAlert = alerts.find(a => a.type === 'per_agent');
        expect(perAgentAlert).toBeUndefined();
      });

      it('should alert when per-agent daily total exceeds cap', () => {
        vi.mocked(getAgentDailyCost).mockReturnValue(10.5);

        const alerts = checkCostLimits('agent-1', undefined, {
          per_agent_usd: 10.0,
          per_issue_usd: 25.0,
          daily_total_usd: 100.0,
          alert_threshold: 0.8,
        });

        const perAgentAlert = alerts.find(a => a.type === 'per_agent');
        expect(perAgentAlert).toBeDefined();
        expect(perAgentAlert?.level).toBe('limit_reached');
        expect(perAgentAlert?.currentCost).toBe(10.5);
      });

      it('should scope per-issue limit to daily total, matching the cap window', () => {
        vi.mocked(getDailyTrends).mockReturnValue([
          { date: '2026-07-06', totalCost: 15.0, eventCount: 10, totalTokens: 3000 },
        ]);

        const alerts = checkCostLimits('agent-1', 'issue-1', {
          per_agent_usd: 10.0,
          per_issue_usd: 25.0,
          daily_total_usd: 100.0,
          alert_threshold: 0.8,
        });

        const issueAlert = alerts.find(a => a.type === 'per_issue');
        // At $15/$25 = 60%, below the 80% threshold, so warning level
        expect(issueAlert).toBeUndefined();
      });
    });
  });
});
