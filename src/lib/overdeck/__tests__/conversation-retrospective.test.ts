/**
 * Unit tests for the pipeline retrospective renderer and handler (PAN-3841).
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderRetrospectiveKickoff,
  formatProjectLines,
  stripFrontmatter,
  loadRetrospectiveTemplate,
  handleRetrospectiveConversationCreate,
  isRetrospectiveWindow,
  DEFAULT_RETROSPECTIVE_WINDOW,
} from '../conversation-retrospective.js';

const INLINE_TEMPLATE = `---
name: retrospective
description: test template
---

Pipeline retrospective: {{WINDOW_LABEL}}

Window {{WINDOW_START}} to {{WINDOW_END}}.
Home: {{OVERDECK_HOME}}
Projects:
{{PROJECT_LINES}}
`;

const NOW = new Date('2026-09-16T12:00:00.000Z');

describe('renderRetrospectiveKickoff', () => {
  it('renders the 24h window: title first, ISO start 24h back, no tokens, no frontmatter', () => {
    const out = renderRetrospectiveKickoff({
      template: INLINE_TEMPLATE,
      window: '24h',
      now: NOW,
      overdeckHome: '/home/o/.overdeck',
      projects: [],
    });
    expect(out.split('\n')[0]).toBe('Pipeline retrospective: last 24 hours');
    expect(out).toContain('2026-09-15T12:00:00.000Z');
    expect(out).toContain('2026-09-16T12:00:00.000Z');
    expect(out).toContain('/home/o/.overdeck');
    expect(out).not.toContain('{{');
    expect(out).not.toContain('name: retrospective');
  });

  it('renders the 7d window: label and start 7 days back', () => {
    const out = renderRetrospectiveKickoff({
      template: INLINE_TEMPLATE,
      window: '7d',
      now: NOW,
      overdeckHome: '/home/o/.overdeck',
      projects: [],
    });
    expect(out.split('\n')[0]).toBe('Pipeline retrospective: last 7 days');
    expect(out).toContain('2026-09-09T12:00:00.000Z');
  });
});

describe('stripFrontmatter', () => {
  it('strips a leading frontmatter block and leaves bodies without one untouched', () => {
    expect(stripFrontmatter(INLINE_TEMPLATE)).not.toContain('name: retrospective');
    expect(stripFrontmatter('no frontmatter here')).toBe('no frontmatter here');
  });
});

describe('formatProjectLines', () => {
  it('renders projects with and without github repos', () => {
    expect(formatProjectLines([
      { key: 'alpha', path: '/repos/alpha', githubRepo: 'o/alpha' },
      { key: 'beta', path: '/repos/beta' },
    ])).toBe([
      '- alpha: repo /repos/alpha; github o/alpha',
      '- beta: repo /repos/beta; github none',
    ].join('\n'));
  });

  it('renders the empty case', () => {
    expect(formatProjectLines([])).toBe('- (no registered projects)');
  });
});

describe('isRetrospectiveWindow', () => {
  it('accepts the two known windows and rejects everything else', () => {
    expect(isRetrospectiveWindow('24h')).toBe(true);
    expect(isRetrospectiveWindow('7d')).toBe(true);
    expect(isRetrospectiveWindow('30d')).toBe(false);
    expect(isRetrospectiveWindow(undefined)).toBe(false);
    expect(isRetrospectiveWindow(24)).toBe(false);
    expect(DEFAULT_RETROSPECTIVE_WINDOW).toBe('24h');
  });

  it('rejects inherited Object prototype keys (operator review P2 / 497a66ea)', () => {
    // The original `value in RETROSPECTIVE_WINDOWS` check walked the
    // prototype chain, so any of these would have returned true and then
    // crashed the renderer on `new Date(NaN)`. Own-property check fixes it.
    expect(isRetrospectiveWindow('constructor')).toBe(false);
    expect(isRetrospectiveWindow('toString')).toBe(false);
    expect(isRetrospectiveWindow('__proto__')).toBe(false);
    expect(isRetrospectiveWindow('hasOwnProperty')).toBe(false);
    expect(isRetrospectiveWindow('valueOf')).toBe(false);
  });
});

describe('handleRetrospectiveConversationCreate', () => {
  it('returns 400 for an invalid window and never calls createConversation', async () => {
    const createConversation = vi.fn();
    const res = await handleRetrospectiveConversationCreate(
      { window: '30d' },
      { createConversation },
    );
    expect(res.status).toBe(400);
    const payload = res.body as { body?: Uint8Array } | null;
    expect(JSON.parse(new TextDecoder().decode(payload?.body))).toEqual({ error: 'Invalid window' });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('returns 400 for prototype-inherited window values without creating a conversation', async () => {
    // Operator review: a POST body of { window: 'constructor' } would otherwise
    // pass the `in RETROSPECTIVE_WINDOWS` check, then crash the renderer on
    // `new Date(NaN)`. The own-property check must reject these before any
    // side effect runs.
    const createConversation = vi.fn();
    for (const evil of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const res = await handleRetrospectiveConversationCreate(
        { window: evil },
        { createConversation },
      );
      expect(res.status).toBe(400);
      const payload = res.body as { body?: Uint8Array } | null;
      expect(JSON.parse(new TextDecoder().decode(payload?.body))).toEqual({
        error: 'Invalid window',
      });
    }
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('returns 400 for non-object bodies without creating a conversation', async () => {
    const createConversation = vi.fn();
    for (const bad of [null, [], 'constructor', 24, true]) {
      const res = await handleRetrospectiveConversationCreate(bad, { createConversation });
      expect(res.status).toBe(400);
      const payload = res.body as { body?: Uint8Array } | null;
      expect(JSON.parse(new TextDecoder().decode(payload?.body))).toEqual({
        error: 'Invalid body',
      });
    }
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('delegates with the rendered message and model routing only — no projectKey/issueId', async () => {
    const createConversation = vi.fn(async () => new Response('{}', { status: 201 }));
    await handleRetrospectiveConversationCreate(
      { window: '7d', model: 'm', harness: 'claude-code', projectKey: 'panopticon-cli', issueId: 'PAN-1' },
      {
        createConversation,
        loadTemplate: async () => INLINE_TEMPLATE,
        collectProjects: async () => [],
        now: () => NOW,
        overdeckHome: () => '/home/o/.overdeck',
      },
    );
    expect(createConversation).toHaveBeenCalledTimes(1);
    const arg = createConversation.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.message as string).startsWith('Pipeline retrospective: last 7 days')).toBe(true);
    expect(arg.model).toBe('m');
    expect(arg.harness).toBe('claude-code');
    expect(arg.effort).toBeUndefined();
    expect(arg).not.toHaveProperty('projectKey');
    expect(arg).not.toHaveProperty('issueId');
  });

  it('defaults the window to 24h when body.window is absent', async () => {
    const createConversation = vi.fn(async () => new Response('{}', { status: 201 }));
    await handleRetrospectiveConversationCreate(
      {},
      {
        createConversation,
        loadTemplate: async () => INLINE_TEMPLATE,
        collectProjects: async () => [],
        now: () => NOW,
        overdeckHome: () => '/home/o/.overdeck',
      },
    );
    const arg = createConversation.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.message as string).startsWith('Pipeline retrospective: last 24 hours')).toBe(true);
  });
});

describe('loadRetrospectiveTemplate', () => {
  it('reads the real roles/retrospective.md by default', async () => {
    const raw = await loadRetrospectiveTemplate();
    expect(raw).toContain('{{WINDOW_LABEL}}');
  });

  it('re-reads on every call (no module-level cache)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'retro-template-'));
    const file = join(dir, 'retrospective.md');
    await writeFile(file, 'first version', 'utf-8');
    expect(await loadRetrospectiveTemplate(file)).toBe('first version');
    await writeFile(file, 'edited version', 'utf-8');
    expect(await loadRetrospectiveTemplate(file)).toBe('edited version');
  });
});

// ─── Canonical evidence bridge (data flow, not prompt wording) ────────────────

import {
  collectRetrospectiveEvidence,
  formatEvidence,
  isRecordInWindow,
  EVIDENCE_LIMITS,
  type RetrospectiveProjectLine as PLine,
  type RetrospectiveSourceIssue,
} from '../conversation-retrospective.js';

const WINDOW_START = new Date('2026-09-16T00:00:00.000Z');
// Upper bound of the window; records after it are clock-skewed, not recent.
const NOW_BOUND = new Date('2026-09-17T00:00:00.000Z');

const MIGRATED: PLine = { key: 'panopticon-cli', path: '/repo/pan', githubRepo: 'eltmon/overdeck' };
const LEGACY: PLine = { key: 'legacy-proj', path: '/repo/legacy' };

function record(over: Partial<RetrospectiveSourceIssue> = {}): RetrospectiveSourceIssue {
  return {
    issueId: 'PAN-1',
    title: 'Do the thing',
    updated: '2026-09-16T12:00:00.000Z',
    state: 'CLOSED',
    labels: ['closed-out'],
    pullRequest: { number: 7, state: 'MERGED', reviewDecision: 'APPROVED', mergedAt: '2026-09-16T11:30:00.000Z' },
    ...over,
  };
}

describe('collectRetrospectiveEvidence — data flow through the read door', () => {
  it('surfaces tracker and forge evidence for a project', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [record()],
    });
    expect(project.key).toBe('panopticon-cli');
    expect(project.issues).toHaveLength(1);
    const issue = project.issues[0];
    expect(issue.issueId).toBe('PAN-1');
    expect(issue.title).toBe('Do the thing');
    expect(issue.state).toBe('CLOSED');
    expect(issue.labels).toEqual(['closed-out']);
    expect(issue.pullRequest).toMatchObject({ number: 7, state: 'MERGED', reviewDecision: 'APPROVED' });
  });

  it('surfaces records for a second project through the same injected door', async () => {
    const seen: string[] = [];
    const [project] = await collectRetrospectiveEvidence({
      projects: [LEGACY],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async (p) => { seen.push(p.key); return [record({ issueId: 'LEG-9' })]; },
    });
    expect(seen).toEqual(['legacy-proj']);
    expect(project.issues.map((i) => i.issueId)).toEqual(['LEG-9']);
  });

  it('handles several projects in one pass', async () => {
    const evidence = await collectRetrospectiveEvidence({
      projects: [MIGRATED, LEGACY],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async (p) => [record({ issueId: p.key === 'panopticon-cli' ? 'MIG-1' : 'LEG-1' })],
    });
    expect(evidence.map((e) => e.issues[0].issueId)).toEqual(['MIG-1', 'LEG-1']);
  });

  it('filters by window: keeps in-window, drops out-of-window, flags undated', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [
        record({ issueId: 'IN-1', updated: '2026-09-16T12:00:00.000Z' }),
        record({ issueId: 'OUT-1', updated: '2026-09-15T12:00:00.000Z' }),
        record({ issueId: 'OUT-2', updated: '2020-01-01T00:00:00.000Z' }),
        record({ issueId: 'UNDATED-1', updated: undefined }),
        record({ issueId: 'BADDATE-1', updated: 'not-a-date' }),
      ],
    });
    expect(project.issues.map((i) => i.issueId).sort()).toEqual(['BADDATE-1', 'IN-1', 'UNDATED-1']);
    expect(project.outOfWindow).toBe(2);
    expect(project.undated).toBe(2);
  });

  it('keeps a record exactly on the window boundary', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [record({ issueId: 'EDGE', updated: WINDOW_START.toISOString() })],
    });
    expect(project.issues.map((i) => i.issueId)).toEqual(['EDGE']);
  });

  it('reports an empty project as no evidence rather than crashing', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [],
    });
    expect(project.issues).toEqual([]);
    expect(formatEvidence([project])).toContain('No evidence found for this project');
  });

  it('discloses a failed tracker query instead of implying nothing happened', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => { throw new Error('gh: HTTP 502'); },
    });
    expect(project.unavailable).toBe('gh: HTTP 502');
    const rendered = formatEvidence([project]);
    expect(rendered).toContain('EVIDENCE UNAVAILABLE');
    expect(rendered).toContain('the tracker query for this project');
    expect(rendered).not.toContain('read door');
    expect(rendered).toContain('do not infer that nothing happened');
  });

  it('skips malformed records with no issueId without failing the batch', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [
        { issueId: '' } as RetrospectiveSourceRecord,
        undefined as unknown as RetrospectiveSourceRecord,
        record({ issueId: 'GOOD-1' }),
      ],
    });
    expect(project.issues.map((i) => i.issueId)).toEqual(['GOOD-1']);
  });

  it('tolerates an issue missing every optional field', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [{ issueId: 'BARE', updated: '2026-09-16T12:00:00.000Z' }],
    });
    const issue = project.issues[0];
    expect(issue.labels).toEqual([]);
    expect(issue.pullRequest).toBeUndefined();
    expect(formatEvidence([project])).toContain('pull request: none');
  });

  it('caps issues per project and discloses how many it dropped', async () => {
    const many = Array.from({ length: EVIDENCE_LIMITS.maxIssuesPerProject + 5 }, (_, i) =>
      record({ issueId: `PAN-${i}`, updated: `2026-09-16T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
    const [project] = await collectRetrospectiveEvidence({
      projects: [MIGRATED], windowStart: WINDOW_START,
      now: NOW_BOUND, listRecords: async () => many,
    });
    expect(project.issues).toHaveLength(EVIDENCE_LIMITS.maxIssuesPerProject);
    expect(project.truncated).toBe(5);
    expect(formatEvidence([project])).toContain('dropped by the');
  });

  it('isRecordInWindow classifies in / out / undated', () => {
    expect(isRecordInWindow('2026-09-16T12:00:00.000Z', WINDOW_START, NOW_BOUND)).toBe('in');
    expect(isRecordInWindow('2026-09-15T12:00:00.000Z', WINDOW_START, NOW_BOUND)).toBe('out');
    expect(isRecordInWindow(undefined, WINDOW_START, NOW_BOUND)).toBe('undated');
    expect(isRecordInWindow('garbage', WINDOW_START, NOW_BOUND)).toBe('undated');
  });
});

describe('evidence reaches the rendered kickoff message', () => {
  it('embeds collected evidence in the message the write door receives', async () => {
    const createConversation = vi.fn(async () => new Response('{}', { status: 201 }));
    await handleRetrospectiveConversationCreate(
      { window: '24h' },
      {
        createConversation,
        loadTemplate: async () => `---\nname: retrospective\n---\nPipeline retrospective: {{WINDOW_LABEL}}\n\n## Record evidence\n\n{{EVIDENCE}}\n`,
        collectProjects: async () => [MIGRATED],
        listRecords: async () => [record({ issueId: 'PAN-3836' })],
        now: () => new Date('2026-09-16T18:00:00.000Z'),
        overdeckHome: () => '/home/o/.overdeck',
      },
    );
    const message = (createConversation.mock.calls[0][0] as Record<string, unknown>).message as string;
    expect(message).toContain('PAN-3836');
    expect(message).toContain('reviewDecision' in {} ? '' : 'review APPROVED');
    expect(message).toContain('#7 MERGED');
    expect(message).not.toContain('{{EVIDENCE}}');
  });

  it('applies the request window to the evidence cut-off', async () => {
    const createConversation = vi.fn(async () => new Response('{}', { status: 201 }));
    const seen: Date[] = [];
    await handleRetrospectiveConversationCreate(
      { window: '7d' },
      {
        createConversation,
        loadTemplate: async () => 'X {{EVIDENCE}}',
        collectProjects: async () => [MIGRATED],
        listRecords: async () => [record({ issueId: 'OLD', updated: '2026-09-12T00:00:00.000Z' })],
        now: () => new Date('2026-09-16T18:00:00.000Z'),
        overdeckHome: () => '/home/o/.overdeck',
      },
    );
    // 2026-09-12 is inside 7d of 2026-09-16 but outside 24h.
    const sevenDay = (createConversation.mock.calls[0][0] as Record<string, unknown>).message as string;
    expect(sevenDay).toContain('OLD');
    expect(seen).toEqual([]);

    createConversation.mockClear();
    await handleRetrospectiveConversationCreate(
      { window: '24h' },
      {
        createConversation,
        loadTemplate: async () => 'X {{EVIDENCE}}',
        collectProjects: async () => [MIGRATED],
        listRecords: async () => [record({ issueId: 'OLD', updated: '2026-09-12T00:00:00.000Z' })],
        now: () => new Date('2026-09-16T18:00:00.000Z'),
        overdeckHome: () => '/home/o/.overdeck',
      },
    );
    const oneDay = (createConversation.mock.calls[0][0] as Record<string, unknown>).message as string;
    expect(oneDay).not.toContain('OLD');
    expect(oneDay).toContain('No issue records were updated in this window');
  });
});

// ─── Review cycle 5: the five required corrections ───────────────────────────
// Each of these reproduces a defect the reviewer's probe demonstrated against
// the committed code. They assert behaviour, not wording.


const PROJECT_A = { key: 'alpha', path: '/repos/alpha' };

describe('required #3 — the window has an upper bound', () => {
  it('classifies a future-dated record as future, not in-window', () => {
    // Probe: updated=2099 returned 'in' and sat at the top of every window.
    expect(isRecordInWindow('2099-01-01T00:00:00.000Z', WINDOW_START, NOW_BOUND)).toBe('future');
  });

  it('excludes future-dated records from the snapshot and discloses the count', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [PROJECT_A],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [
        { issueId: 'PAN-1', updated: '2026-09-16T12:00:00.000Z' },
        { issueId: 'PAN-FUTURE', updated: '2099-01-01T00:00:00.000Z' },
      ],
    });
    expect(project.issues.map((i) => i.issueId)).toEqual(['PAN-1']);
    expect(project.future).toBe(1);
    expect(formatEvidence([project])).toContain('dated after the window end');
  });
});

describe('required #1 — global serialized-size budget', () => {
  it('keeps the rendered snapshot under the byte cap and says what it dropped', async () => {
    // Probe: one issue with a 1MB title rendered ~1,000,000 bytes, clearing
    // every per-row cap and blowing the downstream message limit.
    const huge = 'x'.repeat(1_000_000);
    const projects = await collectRetrospectiveEvidence({
      projects: [PROJECT_A, { ...PROJECT_A, key: 'beta' }],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [{
        issueId: 'PAN-1', updated: '2026-09-16T12:00:00.000Z', title: huge,
      }],
    });
    const rendered = formatEvidence(projects);
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(EVIDENCE_LIMITS.maxRenderedBytes);
    expect(rendered).toContain('TRUNCATED');
  });

  it('leaves a normal-sized snapshot untruncated', async () => {
    const projects = await collectRetrospectiveEvidence({
      projects: [PROJECT_A],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [{ issueId: 'PAN-1', updated: '2026-09-16T12:00:00.000Z' }],
    });
    expect(formatEvidence(projects)).not.toContain('TRUNCATED');
  });
});

describe('required #2 — read-door failures reach the snapshot', () => {
  it('surfaces per-path failures returned alongside records', async () => {
    // The production adapter returns { records, failures }; an empty record
    // list with failures must NOT render as "no evidence found".
    const [project] = await collectRetrospectiveEvidence({
      projects: [PROJECT_A],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => ({
        records: [],
        failures: [{ path: '/state/alpha/records', message: 'EACCES: permission denied' }],
      }),
    });
    expect(project.unreadable).toHaveLength(1);
    const rendered = formatEvidence([project]);
    expect(rendered).toContain('EACCES');
    expect(rendered).toContain('INCOMPLETE');
    expect(rendered).not.toContain('No evidence found for this project.');
  });

  it('still accepts the plain-array shape for callers that have no diagnostics', async () => {
    const [project] = await collectRetrospectiveEvidence({
      projects: [PROJECT_A],
      windowStart: WINDOW_START,
      now: NOW_BOUND,
      listRecords: async () => [{ issueId: 'PAN-1', updated: '2026-09-16T12:00:00.000Z' }],
    });
    expect(project.issues).toHaveLength(1);
    expect(project.unreadable).toEqual([]);
  });
});
