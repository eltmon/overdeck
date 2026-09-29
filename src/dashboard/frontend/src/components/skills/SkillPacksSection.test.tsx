/**
 * PAN-4334 WI-16: the skill packs block of the skill overrides panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import { SkillPacksSection, type PackSkillState, type PackState, type SkillPacksSectionProps } from './SkillPacksSection';

function packSkill(overrides: Partial<PackSkillState> & { name: string }): PackSkillState {
  return {
    id: `mattpocock/${overrides.name}`,
    description: '',
    optIn: false,
    bundledOverlap: false,
    global: null,
    project: null,
    issue: null,
    enabled: false,
    source: 'default',
    inherited: { enabled: false, source: 'default' },
    ...overrides,
  };
}

function pack(overrides: Partial<PackState> = {}): PackState {
  return {
    id: 'mattpocock',
    url: 'https://github.com/mattpocock/skills',
    ref: 'v1.2.3',
    commit: 'c55ee46073ed'.padEnd(40, '0'),
    adapter: 'claude-plugin',
    license: 'MIT',
    cached: true,
    notApplied: [],
    disclosure: null,
    duplicatePluginInstall: false,
    global: null,
    project: null,
    issue: null,
    enabled: false,
    source: 'default',
    inherited: { enabled: false, source: 'default' },
    skills: [
      packSkill({ name: 'grilling', bundledOverlap: true, description: 'Grill the plan' }),
      packSkill({ name: 'setup-matt-pocock-skills', optIn: true }),
    ],
    ...overrides,
  };
}

let putBodies: unknown[];

beforeEach(() => {
  putBodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ packs: [] }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(props: SkillPacksSectionProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SkillPacksSection {...props} />
    </QueryClientProvider>,
  );
}

function packRow(id: string): HTMLElement {
  const element = document.querySelector(`[data-pack="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`pack ${id} not rendered`);
  return element;
}

describe('SkillPacksSection', () => {
  it('shows the pack summary and expands to its skills', () => {
    renderSection({ level: 'global', packs: [pack()] });
    const row = packRow('mattpocock');
    expect(within(row).getByText('https://github.com/mattpocock/skills @ v1.2.3 (c55ee46)')).toBeTruthy();
    expect(within(row).getByText('MIT · 2 skills, 1 opt-in · Not applied: none')).toBeTruthy();
    expect(document.querySelector('[data-pack-skill]')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'mattpocock' }));
    expect(document.querySelector('[data-pack-skill="mattpocock/grilling"]')).toBeTruthy();
    expect(screen.getByText('Overdeck also bundles grilling')).toBeTruthy();
  });

  it('shows the sageox disclosure and none for a pack without one', () => {
    const disclosure = 'SageOx records agent sessions on this machine. With uploads off nothing is sent.';
    renderSection({ level: 'global', packs: [pack(), pack({ id: 'sageox', disclosure, skills: [] })] });
    expect(within(packRow('sageox')).getByTestId('pack-disclosure').textContent).toBe(disclosure);
    expect(within(packRow('mattpocock')).queryByTestId('pack-disclosure')).toBeNull();
  });

  it('notes the opt-in skill', () => {
    renderSection({ level: 'global', packs: [pack()] });
    fireEvent.click(within(packRow('mattpocock')).getByRole('button', { name: 'mattpocock' }));
    const optIn = document.querySelector('[data-pack-skill="mattpocock/setup-matt-pocock-skills"]') as HTMLElement;
    expect(within(optIn).getByText('Edits repo files; not turned on by the pack.')).toBeTruthy();
  });

  it('sends an issue-level pack Off', async () => {
    renderSection({ level: 'issue', issueId: 'PAN-1', packs: [pack()] });
    const group = within(packRow('mattpocock')).getByRole('group', { name: 'mattpocock pack at issue level' });
    fireEvent.click(within(group).getByRole('button', { name: 'Off' }));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'issue', pack: 'mattpocock', enabled: false, issueId: 'PAN-1' }]));
  });

  it('labels Inherit with the inherited pack value', () => {
    renderSection({ level: 'project', projectKey: 'tst', packs: [pack({ inherited: { enabled: true, source: 'global' } })] });
    expect(within(packRow('mattpocock')).getByRole('button', { name: 'Inherit (on via global)' })).toBeTruthy();
  });

  it('labels a pack skill Inherit with the pack level it comes from', async () => {
    const skills = [packSkill({ name: 'tdd', inherited: { enabled: true, source: 'project-pack' } })];
    renderSection({ level: 'issue', issueId: 'PAN-1', packs: [pack({ skills })] });
    fireEvent.click(within(packRow('mattpocock')).getByRole('button', { name: 'mattpocock' }));
    const skillRow = document.querySelector('[data-pack-skill="mattpocock/tdd"]') as HTMLElement;
    fireEvent.click(within(skillRow).getByRole('button', { name: 'Inherit (on via pack at project)' }));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'issue', skill: 'mattpocock/tdd', enabled: null, issueId: 'PAN-1' }]));
  });

  it('turns the pack on at global with the switch', async () => {
    renderSection({ level: 'global', packs: [pack()] });
    fireEvent.click(within(packRow('mattpocock')).getByRole('switch', { name: 'mattpocock pack global' }));
    await waitFor(() => expect(putBodies).toEqual([{ level: 'global', pack: 'mattpocock', enabled: true }]));
  });

  it('shows the not-cached and duplicate-install notices', () => {
    renderSection({ level: 'project', projectKey: 'tst', packs: [pack({ cached: false, skills: [], duplicatePluginInstall: true })] });
    const row = packRow('mattpocock');
    expect(within(row).getByText('pan skills pack sync mattpocock')).toBeTruthy();
    expect(within(row).getByText('also installed as a Claude plugin — skills will appear twice')).toBeTruthy();
  });

  it('renders the add command when there are no packs', () => {
    renderSection({ level: 'global', packs: [] });
    expect(screen.getByText('No skill packs. Add one from the CLI:')).toBeTruthy();
    expect(screen.getByText('pan skills pack add mattpocock https://github.com/mattpocock/skills --ref v1.2.3')).toBeTruthy();
  });
});
