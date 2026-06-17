/**
 * PAN-1919 no-loss audit: the per-issue record must be a superset of every
 * field previously scattered across project continue, workspace continue, and
 * state.json (harness/model).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  ensureIssueRecordSync,
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  writeAgentHarnessModelSync,
  writeStatusOverrideSync,
  type PanIssueRecord,
} from '../record.js';

const ISSUE_ID = 'PAN-1919';

describe('PAN-1919 no-loss audit', () => {
  let workspacePath: string;

  beforeEach(() => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pan-1919-no-loss-'));
    workspacePath = join(projectRoot, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    rmSync(join(tmpdir(), 'pan-1919-no-loss-*'), { recursive: true, force: true });
  });

  function project() {
    return getProjectConfigFromWorkspacePath(workspacePath);
  }

  function assertHasFields(record: PanIssueRecord, fields: (keyof PanIssueRecord)[]) {
    for (const field of fields) {
      expect(record, `record must carry ${field}`).toHaveProperty(field);
    }
  }

  it('record schema supports every legacy project-continue field', () => {
    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      join(recordsDir, `${ISSUE_ID.toLowerCase()}.json`),
      JSON.stringify({
        issueId: ISSUE_ID,
        schemaVersion: 2,
        decisions: [{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01T00:00:00Z' }],
        hazards: [{ id: 'H1', summary: 'big refactor', mitigation: 'audit' }],
        resumePoint: { description: 'resume at record writer', beadId: 'bead-1' },
        beadsMapping: { 'item-1': ['bead-1'] },
        sessionHistory: [{ reason: 'work', timestamp: '2026-01-01T00:00:00Z' }],
        feedback: [{ seq: 1, specialist: 'review-agent', outcome: 'changes-requested', timestamp: '2026-01-01T00:00:00Z', markdownBody: 'fix it' }],
        pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00Z' },
        closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      }),
    );

    const record = readIssueRecordSync(project(), ISSUE_ID)!;
    assertHasFields(record, ['decisions', 'hazards', 'resumePoint', 'beadsMapping', 'sessionHistory', 'feedback']);
  });

  it('record carries statusOverrides from workspace continue', () => {
    writeStatusOverrideSync(project(), ISSUE_ID, 'item-1', 'completed');

    const record = readIssueRecordSync(project(), ISSUE_ID);
    expect(record?.statusOverrides).toEqual({ 'item-1': 'completed' });
  });

  it('record carries harness/model from state.json', () => {
    writeAgentHarnessModelSync(project(), ISSUE_ID, 'pi', 'kimi-k2.7-code');

    const record = readIssueRecordSync(project(), ISSUE_ID);
    expect(record?.harness).toBe('pi');
    expect(record?.model).toBe('kimi-k2.7-code');
  });

  it('record is a superset of all legacy fields', () => {
    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      join(recordsDir, `${ISSUE_ID.toLowerCase()}.json`),
      JSON.stringify({
        issueId: ISSUE_ID,
        schemaVersion: 2,
        decisions: [{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01T00:00:00Z' }],
        hazards: [{ id: 'H1', summary: 'big refactor', mitigation: 'audit' }],
        resumePoint: { description: 'resume at record writer', beadId: 'bead-1' },
        beadsMapping: { 'item-1': ['bead-1'] },
        sessionHistory: [{ reason: 'work', timestamp: '2026-01-01T00:00:00Z' }],
        feedback: [{ seq: 1, specialist: 'review-agent', outcome: 'changes-requested', timestamp: '2026-01-01T00:00:00Z', markdownBody: 'fix it' }],
        statusOverrides: { 'item-1': 'completed' },
        harness: 'codex',
        model: 'gpt-5.5',
        pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00Z' },
        closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      }),
    );

    const record = readIssueRecordSync(project(), ISSUE_ID);
    expect(record).not.toBeNull();
    assertHasFields(record!, [
      'decisions',
      'hazards',
      'resumePoint',
      'beadsMapping',
      'statusOverrides',
      'sessionHistory',
      'feedback',
      'harness',
      'model',
    ]);
  });

  it('has no production callers of retired continue writers', { timeout: 30_000 }, () => {
    const srcRoot = join(process.cwd(), 'src');
    const legacyStateModule = 'src/lib/vbrief/continue-state.ts';

    const forbidden = [
      'writeWorkspaceContinue(',
      'writeWorkspaceContinueSync(',
      'writeContinueFile(',
      'deleteContinueFile(',
      'writeContinueStateForIssue(',
    ];

    const offenders: string[] = [];

    function scan(dir: string) {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const rel = relative(srcRoot, fullPath);

        if (entry === '__tests__' || entry === '__mocks__') continue;
        if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
        if (rel === legacyStateModule.replace('src/', '')) continue;

        const s = statSync(fullPath);
        if (s.isDirectory()) {
          scan(fullPath);
          continue;
        }
        if (!entry.endsWith('.ts') && !entry.endsWith('.tsx') && !entry.endsWith('.js') && !entry.endsWith('.jsx')) {
          continue;
        }

        const content = readFileSync(fullPath, 'utf-8');
        for (const pattern of forbidden) {
          if (content.includes(pattern)) {
            offenders.push(`${rel}: ${pattern}`);
          }
        }
      }
    }

    scan(srcRoot);

    expect(offenders).toEqual([]);
  });

  it('cross-machine resume: record alone survives without DB or state.json', () => {
    // Machine A: write a fully populated record.
    const machineAProjectRoot = mkdtempSync(join(tmpdir(), 'pan-1919-machine-a-'));
    const machineAWorkspace = join(machineAProjectRoot, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(machineAWorkspace, { recursive: true });
    const machineAProject = getProjectConfigFromWorkspacePath(machineAWorkspace);

    mkdirSync(join(machineAWorkspace, '.pan', 'records'), { recursive: true });
    writeFileSync(
      join(machineAWorkspace, '.pan', 'records', `${ISSUE_ID.toLowerCase()}.json`),
      JSON.stringify({
        issueId: ISSUE_ID,
        schemaVersion: 2,
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        decisions: [{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01T00:00:00Z' }],
        hazards: [{ id: 'H1', summary: 'big refactor', mitigation: 'audit' }],
        resumePoint: { description: 'resume at record writer', beadId: 'bead-1' },
        beadsMapping: { 'item-1': ['bead-1'] },
        sessionHistory: [{ reason: 'work', timestamp: '2026-01-01T00:00:00Z', note: 'machine A' }],
        feedback: [{ seq: 1, specialist: 'review-agent', outcome: 'changes-requested', timestamp: '2026-01-01T00:00:00Z', markdownBody: 'fix it' }],
        statusOverrides: { 'item-1': 'completed' },
        harness: 'pi',
        model: 'kimi-k2.7-code',
        pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00Z' },
        closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      }),
      'utf-8',
    );

    // Machine B: fresh temp dir with the workspace copied in, but no SQLite
    // agents row and no ~/.panopticon/agents/state.json.
    const machineBProjectRoot = mkdtempSync(join(tmpdir(), 'pan-1919-machine-b-'));
    const machineBWorkspace = join(machineBProjectRoot, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    cpSync(machineAWorkspace, machineBWorkspace, { recursive: true });

    // Assert machine B has no agent state.json at the default path.
    const machineBProject = getProjectConfigFromWorkspacePath(machineBWorkspace);

    // Read from the record on machine B.
    const record = readIssueRecordSync(machineBProject, ISSUE_ID);
    expect(record).not.toBeNull();
    expect(record!.harness).toBe('pi');
    expect(record!.model).toBe('kimi-k2.7-code');
    expect(record!.statusOverrides).toEqual({ 'item-1': 'completed' });
    expect(record!.decisions).toEqual([{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01T00:00:00Z' }]);
    expect(record!.hazards).toEqual([{ id: 'H1', summary: 'big refactor', mitigation: 'audit' }]);
    expect(record!.sessionHistory).toEqual([{ reason: 'work', timestamp: '2026-01-01T00:00:00Z', note: 'machine A' }]);

    rmSync(machineAProjectRoot, { recursive: true, force: true });
    rmSync(machineBProjectRoot, { recursive: true, force: true });
  });
});
