import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INPUT_PURGE_MAX_CHARS } from '../../channels/injection-budget.js';

const loadConfigSync = vi.hoisted(() => vi.fn(() => ({ trackers: undefined })));

vi.mock('../../config.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../config.js')>(),
  loadConfigSync,
}));

import { writeIssueRecordSync } from '../../pan-dir/record.js';
import { buildWorkAgentPrompt } from '../work-agent-prompt.js';

let workspace = '';

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = '';
  vi.clearAllMocks();
});

describe('work-agent feedback context', () => {
  it('bounds repeated feedback without serializing it again in the record context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-work-prompt-feedback-'));
    workspace = join(root, 'feature-foo-3559');
    mkdirSync(join(workspace, '.pan', 'records'), { recursive: true });

    const repeatedFeedback = {
      seq: 1,
      specialist: 'ci-monitor' as const,
      outcome: 'FAILED',
      timestamp: '2026-08-05T00:00:00.000Z',
      markdownBody: 'review/test feedback could not be delivered',
    };
    const oversizedFeedback = {
      seq: 2,
      specialist: 'review-agent' as const,
      outcome: 'CHANGES_REQUESTED',
      timestamp: '2026-08-05T00:01:00.000Z',
      markdownBody: 'x'.repeat(30_000),
    };
    writeIssueRecordSync({ name: 'test', path: workspace }, 'FOO-3559', {
      issueId: 'FOO-3559',
      schemaVersion: 2,
      created: '2026-08-05T00:00:00.000Z',
      updated: '2026-08-05T00:00:00.000Z',
      decisions: [],
      hazards: [],
      resumePoint: null,
      statusOverrides: {},
      sessionHistory: [],
      feedback: [...Array.from({ length: 265 }, () => repeatedFeedback), oversizedFeedback],
      pipeline: null,
      closeOut: null,
    });

    const prompt = await buildWorkAgentPrompt({
      issueId: 'FOO-3559',
      env: 'LOCAL',
      workspacePath: workspace,
      projectRoot: workspace,
    });

    expect(prompt.length).toBeLessThan(INPUT_PURGE_MAX_CHARS);
    expect(prompt).toContain('repeated 265 times');
    expect(prompt).toContain('Additional feedback omitted to keep the kickoff prompt within its delivery limit.');
    expect(prompt).not.toContain('"feedback"');
  });
});
