/**
 * Tests for cost-monitor.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordCost,
  checkCostLimits,
  getAgentCost,
  getIssueCost,
  getDailyTotal,
  getCostSummary,
  resetCostTracking,
} from '../../src/lib/cloister/cost-monitor.js';

describe('cost-monitor', () => {
  beforeEach(() => {
    // Reset tracking before each test
    resetCostTracking();
  });

  describe('recordCost', () => {
    it('should record agent cost', () => {
      recordCost('agent-1', 1.5);
      expect(getAgentCost('agent-1')).toBe(1.5);
    });

    it('should record issue cost', () => {
      recordCost('agent-1', 2.0, 'issue-1');
      expect(getIssueCost('issue-1')).toBe(2.0);
    });

    it('should accumulate costs for same agent', () => {
      recordCost('agent-1', 1.0);
      recordCost('agent-1', 0.5);
      recordCost('agent-1', 0.25);
      expect(getAgentCost('agent-1')).toBe(1.75);
    });

    it('should accumulate costs for same issue', () => {
      recordCost('agent-1', 1.0, 'issue-1');
      recordCost('agent-2', 2.0, 'issue-1');
      recordCost('agent-3', 0.5, 'issue-1');
      expect(getIssueCost('issue-1')).toBe(3.5);
    });

    it('should update daily total', () => {
      recordCost('agent-1', 1.0);
      recordCost('agent-2', 2.0);
      recordCost('agent-3', 0.5);
      expect(getDailyTotal()).toBe(3.5);
    });
  });

  describe('checkCostLimits', () => {
    it('should not alert when under threshold', () => {
      recordCost('agent-1', 1.0);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 10.0,
        per_issue_usd: 25.0,
        daily_total_usd: 100.0,
        alert_threshold: 0.8,
      });
      expect(alerts).toHaveLength(0);
    });

    it('should warn at 80% threshold for agent', () => {
      recordCost('agent-1', 8.0);
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
      recordCost('agent-1', 10.0);
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
      recordCost('agent-1', 10.0, 'issue-1');
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
      recordCost('agent-1', 100.0);
      const alerts = checkCostLimits('agent-1', undefined, {
        per_agent_usd: 0,
        per_issue_usd: 0,
        daily_total_usd: 0,
        alert_threshold: 0.8,
      });

      expect(alerts).toHaveLength(0);
    });
  });

  describe('getCostSummary', () => {
    it('should return empty summary when no costs recorded', () => {
      const summary = getCostSummary();
      expect(summary.dailyTotal).toBe(0);
      expect(summary.topAgents).toHaveLength(0);
      expect(summary.topIssues).toHaveLength(0);
    });

    it('should return sorted top agents', () => {
      recordCost('agent-1', 5.0);
      recordCost('agent-2', 10.0);
      recordCost('agent-3', 2.0);

      const summary = getCostSummary();
      expect(summary.topAgents).toHaveLength(3);
      expect(summary.topAgents[0].agentId).toBe('agent-2');
      expect(summary.topAgents[0].cost).toBe(10.0);
    });

    it('should limit to top 10 agents', () => {
      for (let i = 1; i <= 15; i++) {
        recordCost(`agent-${i}`, i * 1.0);
      }

      const summary = getCostSummary();
      expect(summary.topAgents).toHaveLength(10);
    });
  });

  describe('resetCostTracking', () => {
    it('should clear all cost data', () => {
      recordCost('agent-1', 5.0, 'issue-1');
      recordCost('agent-2', 3.0, 'issue-2');

      resetCostTracking();

      expect(getAgentCost('agent-1')).toBe(0);
      expect(getIssueCost('issue-1')).toBe(0);
      expect(getDailyTotal()).toBe(0);
    });
  });
});
