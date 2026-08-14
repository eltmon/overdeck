import { describe, expect, it, vi } from 'vitest';
import { isRecordPipelineTerminal, reconcileTerminalIssueResidue, type ParkedResiduePatrolDeps } from '../parked-residue.js';
import type { PanIssueRecord } from '../../pan-dir/record.js';
import type { ProjectConfig } from '../../projects.js';

function record(issueId: string, pipeline: Partial<PanIssueRecord['pipeline']> | null): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    pipeline: pipeline === null ? null as unknown as PanIssueRecord['pipeline'] : {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
      ...pipeline,
    },
  } as PanIssueRecord;
}

const PROJECT: ProjectConfig = { name: 'fixture', path: '/tmp/fixture-project' };

describe('isRecordPipelineTerminal', () => {
  it('closedOut=true is terminal', () => {
    expect(isRecordPipelineTerminal(record('PAN-1', { closedOut: true }))).toBe(true);
  });

  it('mergeStatus=merged with no reopenedAt is terminal', () => {
    expect(isRecordPipelineTerminal(record('PAN-2', { mergeStatus: 'merged' }))).toBe(true);
  });

  it('mergeStatus=merged WITH reopenedAt is not terminal', () => {
    expect(isRecordPipelineTerminal(record('PAN-3', { mergeStatus: 'merged', reopenedAt: '2026-08-10T00:00:00.000Z' }))).toBe(false);
  });

  it('no terminal evidence is not terminal', () => {
    expect(isRecordPipelineTerminal(record('PAN-4', {}))).toBe(false);
  });

  it('a missing pipeline is not terminal', () => {
    expect(isRecordPipelineTerminal(record('PAN-5', null))).toBe(false);
  });
});

describe('reconcileTerminalIssueResidue', () => {
  function deps(overrides: Partial<ParkedResiduePatrolDeps> = {}): ParkedResiduePatrolDeps {
    return {
      listRecords: async () => [],
      ackTrips: async () => 0,
      clearGates: () => [],
      ...overrides,
    };
  }

  it('AC1: a terminal record with an open trip is acked, its stopped rows gated, and one action message names the issue', async () => {
    const ackTrips = vi.fn(async (issueId: string) => (issueId === 'PAN-100' ? 1 : 0));
    const clearGates = vi.fn((issueId: string) => (issueId === 'PAN-100' ? ['agent-pan-100-work'] : []));
    const actions = await reconcileTerminalIssueResidue(
      [{ config: PROJECT }],
      deps({
        listRecords: async () => [record('PAN-100', { closedOut: true })],
        ackTrips,
        clearGates,
      }),
    );

    expect(ackTrips).toHaveBeenCalledWith('PAN-100');
    expect(clearGates).toHaveBeenCalledWith('PAN-100');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ level: 'action' });
    expect(actions[0].message).toContain('PAN-100');
    expect(actions[0].message).toContain('acked 1 open trip(s)');
    expect(actions[0].message).toContain('cleared operator gates on 1 agent row(s)');
  });

  it('AC2: a non-terminal record calls no write doors', async () => {
    const ackTrips = vi.fn(async () => 0);
    const clearGates = vi.fn(() => []);
    const actions = await reconcileTerminalIssueResidue(
      [{ config: PROJECT }],
      deps({
        listRecords: async () => [record('PAN-101', { mergeStatus: 'merged', reopenedAt: '2026-08-10T00:00:00.000Z' })],
        ackTrips,
        clearGates,
      }),
    );

    expect(ackTrips).not.toHaveBeenCalled();
    expect(clearGates).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('AC3: the ack door throwing for one issue emits a warn action and still processes the rest', async () => {
    const ackTrips = vi.fn(async (issueId: string) => {
      if (issueId === 'PAN-102') throw new Error('record lock unavailable');
      return 1;
    });
    const clearGates = vi.fn((issueId: string) => [`agent-${issueId.toLowerCase()}-work`]);
    const actions = await reconcileTerminalIssueResidue(
      [{ config: PROJECT }],
      deps({
        listRecords: async () => [record('PAN-102', { closedOut: true }), record('PAN-103', { closedOut: true })],
        ackTrips,
        clearGates,
      }),
    );

    expect(ackTrips).toHaveBeenCalledWith('PAN-102');
    expect(ackTrips).toHaveBeenCalledWith('PAN-103');
    const warn = actions.find((a) => a.level === 'warn');
    expect(warn?.message).toContain('PAN-102');
    expect(warn?.message).toContain('record lock unavailable');
    const ok = actions.find((a) => a.level === 'action');
    expect(ok?.message).toContain('PAN-103');
  });

  it('skips projects without a path and produces no action when nothing was cleaned', async () => {
    const actions = await reconcileTerminalIssueResidue(
      [{ config: { name: 'no-path' } as ProjectConfig }, { config: PROJECT }],
      deps({ listRecords: async () => [record('PAN-104', { closedOut: true })], ackTrips: async () => 0, clearGates: () => [] }),
    );
    expect(actions).toHaveLength(0);
  });
});
