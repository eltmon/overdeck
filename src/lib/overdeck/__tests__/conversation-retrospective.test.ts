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
  it('renders migrated and legacy variants with and without github repos', () => {
    const out = formatProjectLines([
      { key: 'alpha', path: '/repos/alpha', stateRoot: '/state/alpha', migrated: true, githubRepo: 'o/alpha' },
      { key: 'beta', path: '/repos/beta', stateRoot: '/repos/beta', migrated: false },
    ]);
    expect(out).toBe(
      '- alpha: repo /repos/alpha; state root /state/alpha (migrated layout); github o/alpha\n' +
        '- beta: repo /repos/beta; state root /repos/beta (legacy .pan layout); github none',
    );
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
