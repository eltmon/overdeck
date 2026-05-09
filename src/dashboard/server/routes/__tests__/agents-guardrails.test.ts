import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { evaluateSpawnGuardrails, materializeStartAgentVBrief } from '../agents.js';
import { readGlobalResourceConfig } from '../../services/system-health-service.js';
import type { SystemHealthSnapshot } from '../../services/system-health-service.js';

const GIB = 1024 ** 3;

function createHealthSnapshot(overrides: Partial<SystemHealthSnapshot> = {}): SystemHealthSnapshot {
  const base: SystemHealthSnapshot = {
    severity: 'normal',
    updatedAt: '2026-04-27T00:00:00.000Z',
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.2,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 32 * GIB,
      availableMemoryBytes: 16 * GIB,
      memoryUsedPercent: 50,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 40,
      agentCount: 3,
      workAgentCount: 2,
      planningAgentCount: 1,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 1,
      containerMemoryBytes: 2 * GIB,
    },
    thresholds: {
      memoryAvailableWarningBytes: 4 * GIB,
      memoryAvailableCriticalBytes: 2 * GIB,
      swapUsedWarningPercent: 20,
      swapUsedCriticalPercent: 50,
      cpuLoadWarningPerCore: 1,
      cpuLoadCriticalPerCore: 1.5,
      overcommitWarningPercent: 150,
      overcommitCriticalPercent: 200,
    },
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
  };

  return {
    ...base,
    ...overrides,
    summary: {
      ...base.summary,
      ...overrides.summary,
    },
    thresholds: {
      ...base.thresholds,
      ...overrides.thresholds,
    },
    reasons: overrides.reasons ?? base.reasons,
    agents: overrides.agents ?? base.agents,
    leakedSpecialists: overrides.leakedSpecialists ?? base.leakedSpecialists,
    topConsumers: overrides.topConsumers ?? base.topConsumers,
  };
}

function makeVBrief(issueId: string) {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-08T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: `${issueId}: Test plan`,
      status: 'active',
      items: [{ id: 'item-1', title: 'Do work', status: 'pending' }],
      edges: [],
    },
  };
}

describe('evaluateSpawnGuardrails', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await readGlobalResourceConfig();
  });

  it('does not block exactly at the memory threshold boundary', async () => {
    vi.stubEnv('PAN_MEMORY_WARN_GB', '2');
    vi.stubEnv('PAN_MEMORY_BLOCK_GB', '2');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      summary: {
        availableMemoryBytes: 2 * GIB,
      },
      thresholds: {
        memoryAvailableWarningBytes: 2 * GIB,
        memoryAvailableCriticalBytes: 2 * GIB,
      },
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(false);
    expect(decision.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'memory_pressure', severity: 'critical' })]),
    );
  });

  it('returns acknowledgement-required warnings when work agent count is high but below the hard limit', async () => {
    vi.stubEnv('PAN_AGENT_WARN_COUNT', '5');
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      summary: {
        workAgentCount: 5,
      },
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(true);
    expect(decision.status).toBe(409);
    expect(decision.hint).toBe('Acknowledge the system health warnings before starting this agent.');
    expect(decision.warnings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'agent_capacity',
        message: 'Work agent count is high (5/6).',
      }),
    ]);
  });

  it('blocks spawns when available memory is critically low', async () => {
    vi.stubEnv('PAN_MEMORY_BLOCK_GB', '2');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      severity: 'critical',
      summary: {
        availableMemoryBytes: Math.floor(1.5 * GIB),
      },
      reasons: ['Available RAM below critical threshold'],
    }));

    expect(decision.blocked).toBe(true);
    expect(decision.requiresAcknowledgement).toBe(false);
    expect(decision.status).toBe(429);
    expect(decision.error).toBe('Available RAM is critically low (1.5 GB).');
    expect(decision.hint).toBe('Reduce memory pressure or active work-agent count before retrying.');
    expect(decision.warnings).toEqual([
      expect.objectContaining({
        severity: 'critical',
        code: 'memory_pressure',
      }),
    ]);
  });

  it('warns instead of blocking when work agent count reaches the configured ceiling', async () => {
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      severity: 'critical',
      summary: {
        workAgentCount: 6,
        leakedSpecialistCount: 4,
      },
      leakedSpecialists: [
        { name: 'specialist-pan-1', currentIssue: 'PAN-1', reason: 'parent agent missing' },
        { name: 'specialist-pan-2', currentIssue: 'PAN-2', reason: 'parent agent missing' },
        { name: 'specialist-pan-3', currentIssue: 'PAN-3', reason: 'parent agent missing' },
        { name: 'specialist-pan-4', currentIssue: 'PAN-4', reason: 'parent agent missing' },
      ],
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(true);
    expect(decision.status).toBe(409);
    expect(decision.hint).toBe('Acknowledge the system health warnings before starting this agent.');
    expect(decision.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'agent_capacity',
          message: 'Work agent count is at the configured ceiling (6/6).',
        }),
        expect.objectContaining({
          severity: 'warning',
          code: 'leaked_specialists',
          message: 'Leaked specialist sessions detected: specialist-pan-1 (PAN-1), specialist-pan-2 (PAN-2), specialist-pan-3 (PAN-3), +1 more.',
        }),
      ]),
    );
  });
});

describe('materializeStartAgentVBrief', () => {
  let testDir: string;

  afterEach(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it('treats missing PRD vBRIEF artifacts as non-fatal', async () => {
    testDir = join(tmpdir(), `agents-vbrief-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const projectPath = join(testDir, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-945');
    mkdirSync(workspacePath, { recursive: true });

    await expect(materializeStartAgentVBrief(projectPath, workspacePath, 'PAN-945')).resolves.toEqual({ planPath: null });
  });

  it('imports valid PRD vBRIEF artifacts before start-agent spawn', async () => {
    testDir = join(tmpdir(), `agents-vbrief-valid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const projectPath = join(testDir, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectPath, 'api', 'docs', 'prds', 'planned', 'PAN-945-import-prd-vbrief.vbrief.json');
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(sourcePath, JSON.stringify(makeVBrief('PAN-945'), null, 2));

    const result = await materializeStartAgentVBrief(projectPath, workspacePath, 'PAN-945');

    expect(result.importedSourcePath).toBe(sourcePath);
    expect(result.planPath).toBe(join(workspacePath, '.pan', 'spec.vbrief.json'));
    expect(existsSync(result.planPath!)).toBe(true);
  });

  it('fails closed when an existing PRD vBRIEF artifact is invalid', async () => {
    testDir = join(tmpdir(), `agents-vbrief-invalid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const projectPath = join(testDir, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-945');
    const sourcePath = join(projectPath, 'api', 'docs', 'prds', 'planned', 'PAN-945-invalid.vbrief.json');
    mkdirSync(join(sourcePath, '..'), { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(sourcePath, JSON.stringify({ plan: { id: 'PAN-945' } }, null, 2));

    await expect(materializeStartAgentVBrief(projectPath, workspacePath, 'PAN-945')).rejects.toThrow('Invalid vBRIEF format');
    expect(existsSync(join(workspacePath, '.pan', 'spec.vbrief.json'))).toBe(false);
  });
});
