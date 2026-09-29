/**
 * PAN-3942 WI-7: the shared skill overrides panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import type { ReactElement } from 'react';
import { useDashboardStore } from '../../lib/store';
import { SkillOverridesPanel, type SkillOverridesPanelProps, type SkillState } from './SkillOverridesPanel';
import { IssueSkillsSection, ProjectSkillsSection } from './SkillOverridesSections';

function skill(overrides: Partial<SkillState> & { name: string }): SkillState {
  return {
    description: '', core: false, projectSkill: false,
    global: null, project: null, issue: null, enabled: true, source: 'default',
    ...overrides,
  };
}

const PAN_DONE = skill({ name: 'pan-done', core: true, source: 'core', description: 'Finish work' });
const GRILLING = skill({ name: 'grilling', description: 'Grill the plan' });

let putBodies: unknown[];
let fetchImpl: ReturnType<typeof vi.fn>;

function mockApi(getBody: unknown, putResponse: { ok?: boolean; status?: number; body?: unknown } = {}) {
  putBodies = [];
  fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBodies.push(JSON.parse(String(init.body)));
      const ok = putResponse.ok ?? true;
      return { ok, status: putResponse.status ?? (ok ? 200 : 500), json: async () => putResponse.body ?? { ok: true } };
    }
    return { ok: true, status: 200, json: async () => getBody, url };
  });
  vi.stubGlobal('fetch', fetchImpl);
}

function renderPanel(props: SkillOverridesPanelProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SkillOverridesPanel {...props} />
    </QueryClientProvider>,
  );
}

function renderSection(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

function row(name: string): HTMLElement {
  const element = document.querySelector(`[data-skill="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`row ${name} not rendered`);
  return element;
}

beforeEach(() => {
  putBodies = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkillOverridesPanel — global', () => {
  it('renders a core row with a disabled switch and a normal row, each with a source label', async () => {
    mockApi({ project: null, issue: null, skills: [GRILLING, PAN_DONE], overriddenBelow: {} });
    renderPanel({ level: 'global' });

    await waitFor(() => expect(row('grilling')).toBeTruthy());
    expect(within(row('pan-done')).getByRole('switch')).toHaveProperty('disabled', true);
    expect(within(row('pan-done')).getByText('Core — always on')).toBeTruthy();
    expect(within(row('pan-done')).getByText('core')).toBeTruthy();
    expect(within(row('grilling')).getByRole('switch')).toHaveProperty('disabled', false);
    expect(within(row('grilling')).getByText('default')).toBeTruthy();
    expect(screen.getByText(/Changes apply to Claude Code and Codex agents at their next launch\./)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides');
  });

  it('switches off with enabled false, then back on with enabled null', async () => {
    mockApi({ project: null, issue: null, skills: [GRILLING] });
    const view = renderPanel({ level: 'global' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('grilling')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'global', skill: 'grilling', enabled: false }]));

    mockApi({ project: null, issue: null, skills: [skill({ name: 'grilling', global: false, enabled: false, source: 'global' })] });
    view.unmount();
    renderPanel({ level: 'global' });
    await waitFor(() => expect(within(row('grilling')).getByRole('switch').getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(within(row('grilling')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'global', skill: 'grilling', enabled: null }]));
  });

  it('names the projects and issues that override a skill below global', async () => {
    mockApi({ project: null, issue: null, skills: [GRILLING], overriddenBelow: { grilling: { projects: ['a', 'b'], issues: ['PAN-1'] } } });
    renderPanel({ level: 'global' });
    await waitFor(() => expect(screen.getByText('overridden in 2 projects, 1 issue')).toBeTruthy());
  });
});

describe('SkillOverridesPanel — issue', () => {
  const issueSkills = {
    project: 'tst', issue: 'TST-1',
    skills: [
      PAN_DONE,
      skill({ name: 'grilling', issue: false, enabled: false, source: 'issue' }),
      skill({ name: 'codebase-design', project: false, enabled: false, source: 'project' }),
      skill({ name: 'okf' }),
      skill({ name: 'local', projectSkill: true, issue: true, source: 'issue' }),
    ],
  };

  it('opens filtered to overridden-here or off, collapses core skills, and shows the inherited value', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    expect(document.querySelector('[data-skill="okf"]')).toBeNull();
    expect(document.querySelector('[data-skill="pan-done"]')).toBeNull();
    expect(screen.getByText('1 core skills, always on')).toBeTruthy();
    expect(within(row('local')).getByText('project skill')).toBeTruthy();
    expect(within(row('codebase-design')).getByRole('button', { name: 'Inherit (off via project)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(row('okf')).toBeTruthy();
    expect(within(row('okf')).getByRole('button', { name: 'Inherit (on via global)' })).toBeTruthy();
  });

  it('sends enabled false for Off and enabled null for Inherit', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('local')).getByRole('button', { name: 'Off' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    fireEvent.click(within(row('grilling')).getByRole('button', { name: /^Inherit/ }));
    await waitFor(() => expect(putBodies).toHaveLength(2));

    expect(putBodies).toEqual([
      { level: 'issue', skill: 'local', enabled: false, issueId: 'TST-1' },
      { level: 'issue', skill: 'grilling', enabled: null, issueId: 'TST-1' },
    ]);
  });

  it('shows a row-level error with Retry that resends the same change', async () => {
    mockApi(issueSkills, { ok: false, status: 404, body: { error: 'unknown skill: grilling' } });
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('grilling')).getByRole('button', { name: 'On' }));
    await waitFor(() => expect(within(row('grilling')).getByRole('alert').textContent).toContain('unknown skill: grilling'));
    fireEvent.click(within(row('grilling')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toEqual(putBodies[0]);
  });

  it('reports a pending push as a neutral notice', async () => {
    mockApi(issueSkills, { body: { ok: true, committed: true, pushed: false, reason: 'main has no upstream' } });
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());
    fireEvent.click(within(row('grilling')).getByRole('button', { name: 'On' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved locally; push pending: main has no upstream'));
  });

  it('renders nothing for an issue no project owns', async () => {
    fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'no project', code: 'unknown-issue' }) }));
    vi.stubGlobal('fetch', fetchImpl);
    const { container } = renderPanel({ level: 'issue', issueId: 'ZZZ-1' });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('fetches nothing while disabled', () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1', enabled: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('skill override sections', () => {
  afterEach(() => {
    useDashboardStore.setState({ backendPanesById: {} });
  });

  it('issue section fetches nothing until opened, then loads the issue context', async () => {
    mockApi({ project: 'tst', issue: 'TST-1', skills: [GRILLING] });
    renderSection(<IssueSkillsSection issueId="TST-1" />);
    expect(fetchImpl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Skills for this issue' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides?issue=TST-1'));
  });

  it('hides the issue section when no project owns the issue', async () => {
    fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'no project', code: 'unknown-issue' }) }));
    vi.stubGlobal('fetch', fetchImpl);
    renderSection(<IssueSkillsSection issueId="ZZZ-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills for this issue' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Skills for this issue' })).toBeNull());
  });

  it('notes that a change applies at the next launch while an agent is running', async () => {
    useDashboardStore.setState({
      backendPanesById: { p1: { id: 'p1', issue: 'TST-1', role: 'work', harness: 'claude-code', model: 'm', state: 'working' } },
    });
    mockApi({ project: 'tst', issue: 'TST-1', skills: [skill({ name: 'grilling', issue: false, enabled: false, source: 'issue' })] });
    renderSection(<IssueSkillsSection issueId="TST-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills for this issue' }));
    await waitFor(() => expect(row('grilling')).toBeTruthy());
    fireEvent.click(within(row('grilling')).getByRole('button', { name: 'On' }));
    await waitFor(() => expect(screen.getByTestId('skills-changed-since-launch').textContent)
      .toBe('Skills changed since launch; applies next launch (work agent running).'));
  });

  it('project section fetches nothing until opened', async () => {
    mockApi({ project: 'tst', issue: null, skills: [GRILLING] });
    renderSection(<ProjectSkillsSection projectKey="tst" />);
    expect(fetchImpl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides?project=tst'));
  });
});
