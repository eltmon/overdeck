import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CloisterService } from '../../../src/lib/cloister/service.js';
import type { CloisterConfig } from '../../../src/lib/cloister/config.js';
import { DEFAULT_CLOISTER_CONFIG } from '../../../src/lib/cloister/config.js';

vi.mock('../../../src/lib/cloister/cost-monitor.js', () => ({
  checkCostLimits: vi.fn(),
  getCostSummary: vi.fn(() => ({ dailyTotal: 0, topAgents: [], topIssues: [] })),
}));

import { checkCostLimits } from '../../../src/lib/cloister/cost-monitor.js';

const testConfig: CloisterConfig = {
  ...DEFAULT_CLOISTER_CONFIG,
  cost_limits: {
    per_agent_usd: 10.0,
    per_issue_usd: 25.0,
    daily_total_usd: 100.0,
    alert_threshold: 0.8,
  },
};

describe('CloisterService cost alert logging', () => {
  let service: CloisterService;
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CloisterService(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs daily_total alerts with explicit (unattributed) bucket, not undefined', () => {
    vi.mocked(checkCostLimits).mockReturnValue([
      {
        type: 'daily_total',
        level: 'limit_reached',
        currentCost: 432.01,
        limit: 100.0,
        percentUsed: 432.01,
        timestamp: new Date().toISOString(),
      },
    ]);

    (service as any).checkCostAlerts(['agent-pan-2402']);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('for (unattributed)');
    expect(logged).not.toContain('for undefined');
    expect(logged).toContain('daily_total');
  });

  it('logs warning-level daily_total alerts with explicit (unattributed) bucket', () => {
    vi.mocked(checkCostLimits).mockReturnValue([
      {
        type: 'daily_total',
        level: 'warning',
        currentCost: 85.0,
        limit: 100.0,
        percentUsed: 85.0,
        timestamp: new Date().toISOString(),
      },
    ]);

    (service as any).checkCostAlerts(['agent-pan-2402']);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0][0]);
    expect(logged).toContain('for (unattributed)');
    expect(logged).not.toContain('for undefined');
  });

  it('keeps real agent/issue labels when present', () => {
    vi.mocked(checkCostLimits).mockReturnValue([
      {
        type: 'per_agent',
        level: 'warning',
        agentId: 'flywheel-orchestrator',
        currentCost: 8.5,
        limit: 10.0,
        percentUsed: 85.0,
        timestamp: new Date().toISOString(),
      },
      {
        type: 'per_issue',
        level: 'warning',
        issueId: 'PAN-2402',
        currentCost: 20.0,
        limit: 25.0,
        percentUsed: 80.0,
        timestamp: new Date().toISOString(),
      },
    ]);

    (service as any).checkCostAlerts(['agent-pan-2402']);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const logs = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(logs.some((l) => l.includes('for flywheel-orchestrator'))).toBe(true);
    expect(logs.some((l) => l.includes('for PAN-2402'))).toBe(true);
  });
});
