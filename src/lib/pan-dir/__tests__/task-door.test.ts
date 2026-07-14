import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auto-commit.js', () => ({ queueAutoCommit: vi.fn() }));

import type { ProjectConfig } from '../../projects.js';
import { readIssueRecordSync } from '../record.js';
import { applyTaskStatusChange, TaskStatusChangeError } from '../task-door.js';

const ISSUE_ID = 'DOOR-100';

describe('task mutation door', () => {
  let root: string;
  let project: ProjectConfig;
  let specPath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-task-door-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, 'home');
    project = { name: 'door-test', path: join(root, 'project') };
    const specsDir = join(project.path, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    specPath = join(specsDir, '2026-07-14-DOOR-100-task-door.vbrief.json');
    writeFileSync(specPath, JSON.stringify({
      status: 'active',
      vBRIEFInfo: { version: '1.0', created: '2026-07-14T00:00:00.000Z' },
      plan: {
        id: ISSUE_ID,
        title: 'Task door',
        status: 'active',
        items: [
          { id: 'wi-1', title: 'First', status: 'pending', items: [{ id: 'ac-1', title: 'AC', status: 'pending' }] },
          { id: 'wi-2', title: 'Second', status: 'pending' },
          { id: 'wi-done', title: 'Terminal', status: 'completed' },
        ],
        edges: [],
      },
    }, null, 2));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('claims only pending work and records ownership plus sequence', async () => {
    const result = await applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    expect(result).toMatchObject({ status: 'running', sequence: 1, claim: { writerId: 'agent-a' } });
    expect(readIssueRecordSync(project, ISSUE_ID)).toMatchObject({
      statusOverrides: { 'wi-1': 'running' },
      tasks: { sequence: 1, claims: { 'wi-1': { writerId: 'agent-a' } } },
    });
  });

  it('makes same-writer re-claim idempotent and rejects a different writer', async () => {
    await applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' }))
      .resolves.toMatchObject({ idempotent: true, sequence: 1 });
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-b' }))
      .rejects.toThrow(/current claim owner is agent-a/i);
  });

  it('allows only the claim owner to complete and archives the claim', async () => {
    await applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type: 'done', itemId: 'wi-1', writerId: 'agent-b' }))
      .rejects.toThrow(/claim owner is agent-a/i);
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type: 'done', itemId: 'wi-1', writerId: 'agent-a' }))
      .resolves.toMatchObject({ status: 'completed', sequence: 2 });
    expect(readIssueRecordSync(project, ISSUE_ID)).toMatchObject({
      statusOverrides: { 'wi-1': 'completed', 'wi-1.ac-1': 'completed' },
      tasks: { claims: {}, claimHistory: [{ itemId: 'wi-1', outcome: 'completed' }] },
    });
  });

  it.each([
    ['block', undefined, /requires --reason/i],
    ['cancel', undefined, /requires --reason/i],
    ['done', undefined, /not allowed/i],
  ] as const)('rejects illegal %s transitions with an operator-readable recovery command', async (type, reason, message) => {
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type, itemId: 'wi-1', writerId: 'agent-a', reason }))
      .rejects.toMatchObject({ message: expect.stringMatching(message) });
    await expect(applyTaskStatusChange(project, ISSUE_ID, { type, itemId: 'wi-1', writerId: 'agent-a', reason }))
      .rejects.toThrow(`pan task show ${ISSUE_ID} wi-1`);
  });

  it('never resurrects a terminal task, even with force', async () => {
    await expect(applyTaskStatusChange(project, ISSUE_ID, {
      type: 'claim', itemId: 'wi-done', writerId: 'operator', force: true, reason: 'retry',
    })).rejects.toThrow(/is completed/i);
  });

  it('audits a forced transition and advances sequence exactly once', async () => {
    await expect(applyTaskStatusChange(project, ISSUE_ID, {
      type: 'done', itemId: 'wi-1', writerId: 'operator', force: true, reason: 'operator override', expectedSequence: 0,
    })).resolves.toMatchObject({ status: 'completed', sequence: 1 });
    expect(readIssueRecordSync(project, ISSUE_ID)?.tasks?.statusReasons?.['wi-1']).toMatchObject({
      reason: 'operator override', forced: true,
    });
  });

  it('rejects stale expected sequences with the current sequence', async () => {
    await applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    const error = await applyTaskStatusChange(project, ISSUE_ID, {
      type: 'claim', itemId: 'wi-2', writerId: 'agent-b', expectedSequence: 0,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TaskStatusChangeError);
    expect(error).toMatchObject({ details: { currentSequence: 1 } });
  });

  it('does not rewrite the canonical specification', async () => {
    const before = readFileSync(specPath);
    await applyTaskStatusChange(project, ISSUE_ID, { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    await applyTaskStatusChange(project, ISSUE_ID, { type: 'done', itemId: 'wi-1', writerId: 'agent-a' });
    expect(readFileSync(specPath)).toEqual(before);
  });
});
