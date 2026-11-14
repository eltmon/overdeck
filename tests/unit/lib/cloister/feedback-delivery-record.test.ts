/**
 * PAN-5218: the delivery record carries a relay's details only when it passes them.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordFeedbackDelivered, recordFeedbackUndelivered } from '../../../../src/lib/cloister/feedback-delivery-record.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';

let workspace: string;

beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'pan-5218-record-')); });
afterEach(() => { rmSync(workspace, { recursive: true, force: true }); });

describe('recordFeedbackDelivered', () => {
  it('writes exactly kind, dedupKey and agentId for a review or UAT relay that passes no details', () => {
    recordFeedbackDelivered(workspace, { issueId: 'PAN-1', kind: 'review', dedupKey: 'k', agentId: 'agent-pan-1', source: 'review' });
    const [entry] = readPipelineJournal(workspace);
    expect(entry.type).toBe('feedback.delivered');
    expect(entry.data).toEqual({ kind: 'review', dedupKey: 'k', agentId: 'agent-pan-1' });
  });

  it('spreads details after the three fields', () => {
    recordFeedbackDelivered(workspace, {
      issueId: 'PAN-1', kind: 'coderabbit', dedupKey: 'k', agentId: 'a', source: 's', details: { prNumber: 42, threads: [] },
    });
    expect(readPipelineJournal(workspace)[0].data).toEqual({ kind: 'coderabbit', dedupKey: 'k', agentId: 'a', prNumber: 42, threads: [] });
  });
});

describe('recordFeedbackUndelivered', () => {
  it('writes feedback.undelivered with the reason and details', () => {
    recordFeedbackUndelivered(workspace, {
      issueId: 'PAN-1', kind: 'coderabbit', dedupKey: 'k', reason: 'no agent', source: 's', details: { prNumber: 42 },
    });
    const [entry] = readPipelineJournal(workspace);
    expect(entry.type).toBe('feedback.undelivered');
    expect(entry.data).toEqual({ kind: 'coderabbit', dedupKey: 'k', reason: 'no agent', prNumber: 42 });
  });

  it('does nothing without a workspace', () => {
    expect(() => recordFeedbackUndelivered(undefined, { issueId: 'PAN-1', kind: 'coderabbit', dedupKey: 'k', reason: 'r', source: 's' }))
      .not.toThrow();
  });
});
