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
import { IssueSkillsSection, IssueSkillsTabPanel, ProjectSkillsSection } from './SkillOverridesSections';

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

type PutResponse = { ok?: boolean; status?: number; body?: unknown };

/** One response answers every PUT; an array answers PUTs in order, the last entry repeating. */
function mockApi(getBody: unknown, putResponse: PutResponse | PutResponse[] = {}) {
  putBodies = [];
  const responses = Array.isArray(putResponse) ? putResponse : [putResponse];
  fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const response = responses[Math.min(putBodies.length, responses.length - 1)] ?? {};
      putBodies.push(JSON.parse(String(init.body)));
      const ok = response.ok ?? true;
      return { ok, status: response.status ?? (ok ? 200 : 500), json: async () => response.body ?? { ok: true } };
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

function group(key: string): HTMLElement {
  const element = document.querySelector(`[data-skill-group="${key}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`group ${key} not rendered`);
  return element;
}

/** A changed skill renders in the "changed" group and in its home group; name the copy. */
function rowIn(groupKey: string, name: string): HTMLElement {
  const element = group(groupKey).querySelector(`[data-skill="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`row ${name} not rendered in ${groupKey}`);
  return element;
}

function getCount(): number {
  return fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'PUT').length;
}

beforeEach(() => {
  putBodies = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkillOverridesPanel — global', () => {
  it('groups skills by origin, with core collapsed behind a locked header', async () => {
    mockApi({ project: null, issue: null, skills: [GRILLING, PAN_DONE], overriddenBelow: {} });
    renderPanel({ level: 'global' });

    await waitFor(() => expect(row('grilling')).toBeTruthy());
    expect(within(row('grilling')).getByRole('switch')).toHaveProperty('disabled', false);
    expect(within(row('grilling')).queryByText('default')).toBeNull();
    expect(document.querySelector('[data-skill="pan-done"]')).toBeNull();
    expect(screen.getByText('Always on; the pipeline depends on them')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Core' }));
    expect(within(row('pan-done')).getByRole('switch')).toHaveProperty('disabled', true);
    expect(within(row('pan-done')).getByRole('switch').getAttribute('aria-label')).toBe('pan-done is a core skill, always on');
    expect(screen.getByTestId('skills-summary').textContent).toBe('2 on·0 off·1 core');
    expect(screen.getByText(/Changes apply to Claude Code and Codex agents at their next launch\./)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides');
    expect(screen.queryByRole('button', { name: /^Pin /})).toBeNull();
    expect(document.querySelector('[data-skill-group="changed"]')).toBeNull();
  });

  it('collapses the Overdeck group until a search matches inside it', async () => {
    const remotion = skill({ name: 'remotion', origin: 'overdeck', description: 'Render video' });
    mockApi({ project: null, issue: null, skills: [GRILLING, remotion] });
    renderPanel({ level: 'global' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    expect(document.querySelector('[data-skill="remotion"]')).toBeNull();
    expect(within(document.querySelector('[data-skill-group="overdeck"]') as HTMLElement).getByText('1 of 1 on')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter skills' }), { target: { value: 'video' } });
    expect(row('remotion')).toBeTruthy();
    expect(document.querySelector('[data-skill-group="personal"]')).toBeNull();
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

  it('opens on All, with core collapsed and every skill listed', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-skill="pan-done"]')).toBeNull();
    expect(screen.getByText('1 core skills, always on')).toBeTruthy();
    expect(within(rowIn('project', 'local')).getByText('project skill')).toBeTruthy();
    expect(screen.getByTestId('skills-summary').textContent).toBe('3 on·2 off·2 changed here·1 core');
  });

  it('offers All, Changed here and Off, with counts', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All5');
    expect(screen.getByRole('button', { name: /^Changed here/ }).textContent).toBe('Changed here2');
    expect(screen.getByRole('button', { name: /^Off/ }).textContent).toBe('Off2');
    expect(screen.queryByRole('button', { name: /Overridden here/ })).toBeNull();
  });

  it('Changed here lists only skills with a stored value at this level', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Changed here/ }));
    expect(row('grilling')).toBeTruthy();
    expect(row('local')).toBeTruthy();
    expect(document.querySelector('[data-skill="okf"]')).toBeNull();
    expect(document.querySelector('[data-skill="codebase-design"]')).toBeNull();
  });

  it('lists changed skills first and keeps them in their home group', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    expect(document.querySelector('[data-skill-group]')?.getAttribute('data-skill-group')).toBe('changed');
    expect(within(group('changed')).getByText('Changed for this issue')).toBeTruthy();
    expect(within(group('changed')).getByText('grilling')).toBeTruthy();
    expect(within(group('changed')).getByText('local')).toBeTruthy();
    expect(within(group('changed')).queryByText('okf')).toBeNull();
    expect(screen.getByTestId('skills-changed-count').textContent).toBe('2');
    expect(rowIn('personal', 'grilling')).toBeTruthy();
    expect(rowIn('project', 'local')).toBeTruthy();
  });

  it('Reset all clears each changed skill in order and reloads once', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await waitFor(() => expect(putBodies).toEqual([
      { level: 'issue', skill: 'grilling', enabled: null, issueId: 'TST-1' },
      { level: 'issue', skill: 'local', enabled: null, issueId: 'TST-1' },
    ]));
    await waitFor(() => expect(getCount()).toBe(2));
  });

  it('Reset all stops at the first failure and shows that row\'s error', async () => {
    mockApi(issueSkills, [{ ok: false, status: 500, body: { error: 'push rejected' } }]);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await waitFor(() => expect(within(rowIn('changed', 'grilling')).getByRole('alert').textContent).toContain('push rejected'));
    expect(putBodies).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset all' })).not.toBeDisabled());
  });

  it('disables every switch in the panel while a Reset all PUT is pending', async () => {
    const oneChanged = {
      project: 'tst', issue: 'TST-1',
      skills: [skill({ name: 'grilling', issue: false, enabled: false, source: 'issue' }), skill({ name: 'okf' })],
    };
    let resolvePut: (() => void) | undefined;
    fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)));
        await new Promise<void>(resolve => { resolvePut = resolve; });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => oneChanged, url };
    });
    vi.stubGlobal('fetch', fetchImpl);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    for (const switchEl of screen.getAllByRole('switch')) {
      expect(switchEl).toHaveProperty('disabled', true);
    }
    resolvePut?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset all' })).not.toBeDisabled());
  });

  it('disables Reset all while an individual row save is pending', async () => {
    const oneChanged = {
      project: 'tst', issue: 'TST-1',
      skills: [skill({ name: 'grilling', issue: false, enabled: false, source: 'issue' }), skill({ name: 'okf' })],
    };
    let resolvePut: (() => void) | undefined;
    fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)));
        await new Promise<void>(resolve => { resolvePut = resolve; });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => oneChanged, url };
    });
    vi.stubGlobal('fetch', fetchImpl);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.click(within(row('okf')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeDisabled();
    resolvePut?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset all' })).not.toBeDisabled());
  });

  it('says nothing is changed when no skill has a stored value', async () => {
    mockApi({ project: 'tst', issue: 'TST-1', skills: [skill({ name: 'okf' })] });
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    expect(within(group('changed')).getByText("Nothing is changed. This issue's agents launch with the project's skills.")).toBeTruthy();
    expect(screen.getByTestId('skills-changed-count').textContent).toBe('0');
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull();
  });

  it('hides the changed group while searching or filtering', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter skills' }), { target: { value: 'okf' } });
    expect(document.querySelector('[data-skill-group="changed"]')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter skills' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Off/ }));
    expect(document.querySelector('[data-skill-group="changed"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(document.querySelector('[data-skill-group="changed"]')).toBeTruthy();
  });

  it('shows one switch and a source per row, and no Inherit buttons', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    expect(within(row('okf')).getByText('on · global')).toBeTruthy();
    expect(within(row('codebase-design')).getByText('off · project')).toBeTruthy();
    expect(within(row('grilling')).getByText('off · this issue')).toBeTruthy();
    expect(within(row('local')).getByText('on · pinned here')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Inherit/ })).toBeNull();
    expect(within(row('okf')).getAllByRole('switch')).toHaveLength(1);
  });

  it('the switch sends the override, or null when it returns to the inherited value', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('okf')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    fireEvent.click(within(row('grilling')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    fireEvent.click(within(row('codebase-design')).getByRole('switch'));
    await waitFor(() => expect(putBodies).toHaveLength(3));

    expect(putBodies).toEqual([
      { level: 'issue', skill: 'okf', enabled: false, issueId: 'TST-1' },
      { level: 'issue', skill: 'grilling', enabled: null, issueId: 'TST-1' },
      { level: 'issue', skill: 'codebase-design', enabled: true, issueId: 'TST-1' },
    ]);
  });

  it('Pin sends the inherited value and Reset sends null', async () => {
    mockApi(issueSkills);
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('okf')).getByRole('button', { name: 'Pin okf on for this issue' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    fireEvent.click(within(row('codebase-design')).getByRole('button', { name: 'Pin codebase-design off for this issue' }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    fireEvent.click(within(row('local')).getByRole('button', { name: 'Reset local to the global default' }));
    await waitFor(() => expect(putBodies).toHaveLength(3));

    expect(putBodies).toEqual([
      { level: 'issue', skill: 'okf', enabled: true, issueId: 'TST-1' },
      { level: 'issue', skill: 'codebase-design', enabled: false, issueId: 'TST-1' },
      { level: 'issue', skill: 'local', enabled: null, issueId: 'TST-1' },
    ]);
  });

  it('shows a row-level error with Retry that resends the same change', async () => {
    mockApi(issueSkills, { ok: false, status: 404, body: { error: 'unknown skill: grilling' } });
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    fireEvent.click(within(row('grilling')).getByRole('switch'));
    await waitFor(() => expect(within(row('grilling')).getByRole('alert').textContent).toContain('unknown skill: grilling'));
    fireEvent.click(within(row('grilling')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toEqual(putBodies[0]);
    expect(putBodies[0]).toEqual({ level: 'issue', skill: 'grilling', enabled: null, issueId: 'TST-1' });
  });

  it('reports a pending push as a neutral notice', async () => {
    mockApi(issueSkills, { body: { ok: true, committed: true, pushed: false, reason: 'main has no upstream' } });
    renderPanel({ level: 'issue', issueId: 'TST-1' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());
    fireEvent.click(within(row('grilling')).getByRole('switch'));
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

describe('SkillOverridesPanel — project', () => {
  it('uses the same control with project wording', async () => {
    mockApi({
      project: 'tst', issue: null,
      skills: [
        skill({ name: 'grilling', global: false, enabled: false, source: 'global' }),
        skill({ name: 'okf', project: false, enabled: false, source: 'project' }),
      ],
    });
    renderPanel({ level: 'project', projectKey: 'tst' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    expect(within(row('grilling')).getByText('off · global')).toBeTruthy();
    expect(within(row('okf')).getByText('off · this project')).toBeTruthy();

    fireEvent.click(within(row('grilling')).getByRole('switch', { name: 'grilling for this project' }));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'project', skill: 'grilling', enabled: true, projectKey: 'tst' }]));
  });

  it('labels the filters All, Changed here and Off at launch', async () => {
    mockApi({ project: 'tst', issue: null, skills: [GRILLING] });
    renderPanel({ level: 'project', projectKey: 'tst' });
    await waitFor(() => expect(row('grilling')).toBeTruthy());

    expect(screen.getByRole('button', { name: /^All/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Changed here/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Off at launch/ })).toBeTruthy();
  });

  it('shows the project wording when nothing is changed', async () => {
    mockApi({ project: 'tst', issue: null, skills: [skill({ name: 'okf', project: null })] });
    renderPanel({ level: 'project', projectKey: 'tst' });
    await waitFor(() => expect(row('okf')).toBeTruthy());

    expect(within(group('changed')).getByText('Changed for this project')).toBeTruthy();
    expect(within(group('changed')).getByText("Nothing is changed. This project's agents launch with the global skills.")).toBeTruthy();
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

  it('IssueSkillsTabPanel fetches on mount and renders the panel without a disclosure', async () => {
    mockApi({ project: 'tst', issue: 'TST-1', skills: [GRILLING] });
    renderSection(<IssueSkillsTabPanel issueId="TST-1" onUnavailable={vi.fn()} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides?issue=TST-1'));
    expect(screen.queryByRole('button', { name: 'Skills for this issue' })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.getByTestId('drawer-tab-panel-skills')).toHaveAttribute('data-section', 'SkillOverrides');
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
    fireEvent.click(within(row('grilling')).getByRole('switch'));
    await waitFor(() => expect(screen.getByTestId('skills-changed-since-launch').textContent)
      .toBe('Skills changed since launch; applies next launch (work agent running).'));
    const notice = screen.getByTestId('skills-changed-since-launch');
    expect(notice.classList.contains('badge-bg-warning')).toBe(true);
    expect(notice.classList.contains('badge-border-warning')).toBe(true);
  });

  it('project section fetches nothing until opened', async () => {
    mockApi({ project: 'tst', issue: null, skills: [GRILLING] });
    renderSection(<ProjectSkillsSection projectKey="tst" />);
    expect(fetchImpl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/skills/overrides?project=tst'));
  });
});
