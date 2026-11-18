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
import type { AvailableGroup, AvailablePack } from './availablePacks';

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

// PAN-5540: the known packs, as GET /api/skills/packs/available reports them on a fresh machine.
const KNOWN_IDS = ['atlassian', 'deft', 'gstack', 'hyperframes', 'mattpocock', 'openmontage', 'pstack', 'remotion', 'sageox', 'video-use'];
const NEEDS_REF = new Set(['deft', 'gstack', 'mattpocock']);
const VIDEO = ['remotion', 'hyperframes', 'openmontage', 'video-use'];

function availablePack(id: string, overrides: Partial<AvailablePack> = {}): AvailablePack {
  const needsRef = NEEDS_REF.has(id);
  const reason = needsRef ? 'needs-ref' : id === 'sageox' ? 'runs-build' : null;
  return {
    id,
    url: `https://github.com/eltmon/${id}`,
    ref: needsRef ? null : 'e'.repeat(40),
    adapter: 'plain',
    disclosure: id === 'video-use' ? 'video-use sends audio to ElevenLabs Scribe for transcription.' : null,
    added: false,
    dashboardAddable: reason === null,
    reason,
    addCommand: needsRef ? `pan skills pack add ${id} --ref <ref>` : `pan skills pack add ${id}`,
    groups: VIDEO.includes(id) ? ['video'] : [],
    ...overrides,
  };
}

const VIDEO_GROUP: AvailableGroup = {
  name: 'video', packs: VIDEO, source: 'built-in', missing: VIDEO, unknown: [], dashboardAddable: true,
  addCommand: 'pan skills pack add --group video',
};

let putBodies: unknown[];
let availableBody: unknown;

beforeEach(() => {
  putBodies = [];
  availableBody = { packs: [], groups: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url === '/api/skills/packs/available') return { ok: true, status: 200, json: async () => availableBody };
    if (url === '/api/skills/packs/preview') return { ok: false, status: 502, json: async () => ({ error: 'offline', code: 'git' }) };
    return { ok: true, status: 200, json: async () => ({ packs: [] }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(props: SkillPacksSectionProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: SkillPacksSectionProps) => (
    <QueryClientProvider client={client}>
      <SkillPacksSection {...next} />
    </QueryClientProvider>
  );
  const result = render(ui(props));
  return { ...result, rerenderSection: (next: SkillPacksSectionProps) => result.rerender(ui(next)) };
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
    expect(within(row).getByText('MIT · 2 skills')).toBeTruthy();
    expect(within(row).getByText('0 of 2 on')).toBeTruthy();
    expect(document.querySelector('[data-pack-skill]')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'mattpocock' }));
    expect(within(row).getByText('https://github.com/mattpocock/skills @ v1.2.3 (c55ee46)')).toBeTruthy();
    expect(within(row).getByText('1 opt-in · Not applied: none')).toBeTruthy();
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

  it('opens a pack whose skills match the panel search and hides packs without a match', () => {
    renderSection({ level: 'global', packs: [pack(), pack({ id: 'sageox', skills: [] })], search: 'grill' });
    expect(document.querySelector('[data-pack="sageox"]')).toBeNull();
    expect(document.querySelector('[data-pack-skill="mattpocock/grilling"]')).toBeTruthy();
    expect(document.querySelector('[data-pack-skill="mattpocock/setup-matt-pocock-skills"]')).toBeNull();
    expect(within(packRow('mattpocock')).getByText('1 match')).toBeTruthy();
  });

});

describe('Available packs (PAN-5540)', () => {
  const available = (selector: string) => document.querySelector(selector);

  it('lists the missing video group and the not-added known packs at the global level', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [VIDEO_GROUP] };
    renderSection({ level: 'global', packs: [] });

    expect(screen.getByText('No skill packs added yet.')).toBeTruthy();
    await waitFor(() => expect(available('[data-available-group="video"]')).toBeTruthy());
    const video = available('[data-available-group="video"]') as HTMLElement;
    expect(video.textContent).toContain('4 packs not added');
    expect(video.textContent).toContain('remotion, hyperframes, openmontage, video-use');
    expect(within(video).getByRole('button', { name: 'Add the video group' })).toBeTruthy();
    expect(video.textContent).not.toContain('pan skills pack add --group video');

    const gstack = available('[data-available-pack="gstack"]') as HTMLElement;
    expect(gstack.textContent).toContain('Needs a ref. Add it from the CLI:');
    expect(gstack.textContent).toContain('pan skills pack add gstack --ref <ref>');
    expect((available('[data-available-pack="sageox"]') as HTMLElement).textContent).toContain('Adding it builds code on this machine.');
    expect(within(gstack).queryByRole('button')).toBeNull();
    expect(within(available('[data-available-pack="remotion"]') as HTMLElement).getByRole('button', { name: 'Add remotion' })).toBeTruthy();
    expect((available('[data-available-pack="remotion"]') as HTMLElement).textContent).toContain('https://github.com/eltmon/remotion @ eeeeeee');
    expect(document.body.textContent).not.toContain('mattpocock https://github.com/eltmon/skills --ref v1.2.3');
  });

  it('renders one row per not-added known pack', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [] };
    renderSection({ level: 'global', packs: [] });

    await waitFor(() => expect(document.querySelectorAll('[data-available-pack]')).toHaveLength(10));
    expect([...document.querySelectorAll('[data-available-pack]')].map(row => row.getAttribute('data-available-pack'))).toEqual(KNOWN_IDS);
  });

  it('omits added packs and groups with nothing missing, and counts partly added groups', async () => {
    availableBody = {
      packs: KNOWN_IDS.map(id => availablePack(id, { added: id !== 'openmontage' })),
      groups: [
        { ...VIDEO_GROUP, missing: ['openmontage'] },
        { ...VIDEO_GROUP, name: 'done', missing: [] },
      ],
    };
    renderSection({ level: 'global', packs: [pack()] });

    await waitFor(() => expect(available('[data-available-group="video"]')).toBeTruthy());
    expect((available('[data-available-group="video"]') as HTMLElement).textContent).toContain('1 of 4 packs not added');
    expect(available('[data-available-group="done"]')).toBeNull();
    expect(document.querySelectorAll('[data-available-pack]')).toHaveLength(1);
  });

  it('names group members that are not known packs', async () => {
    availableBody = {
      packs: [],
      groups: [{ name: 'mine', packs: ['remotion', 'custom-x'], source: 'config', missing: ['custom-x'], unknown: ['custom-x'], dashboardAddable: false, addCommand: 'pan skills pack add --group mine' }],
    };
    renderSection({ level: 'global', packs: [] });

    await waitFor(() => expect(available('[data-available-group="mine"]')).toBeTruthy());
    expect((available('[data-available-group="mine"]') as HTMLElement).textContent).toContain(
      'custom-x is not a known pack; add it with pan skills pack add <id> <url> --ref <ref>',
    );
  });

  it('points to the Skills page below the global level and lists nothing', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [VIDEO_GROUP] };
    const pushState = vi.spyOn(window.history, 'pushState');
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    renderSection({ level: 'project', projectKey: 'tst', packs: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Skills page' }));
    expect(pushState).toHaveBeenCalledWith({}, '', '/skills');
    expect(popstate).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', popstate);
    expect(screen.queryByTestId('available-packs')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/skills/packs/available')).toBe(false);
  });

  it('renders nothing when the listing body has no arrays', async () => {
    availableBody = { unexpected: true };
    renderSection({ level: 'global', packs: [] });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/skills/packs/available')).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByTestId('available-packs')).toBeNull();
    expect(screen.getByText('No skill packs added yet.')).toBeTruthy();
  });

  it('shows available packs matching the search when no registered pack matches', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [VIDEO_GROUP] };
    renderSection({ level: 'global', packs: [], search: 'remotion' });

    await waitFor(() => expect(available('[data-available-pack="remotion"]')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Add remotion' })).toBeTruthy();
    expect(available('[data-available-pack="gstack"]')).toBeNull();
    expect(available('[data-available-group="video"]')).toBeTruthy();
  });

  it('opens the add dialog for the missing group members and keeps it open while the list changes', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [{ ...VIDEO_GROUP, missing: ['openmontage', 'video-use'] }] };
    const { rerenderSection } = renderSection({ level: 'global', packs: [], search: 'video' });

    fireEvent.click(await screen.findByRole('button', { name: 'Add the video group' }));
    expect(screen.getByRole('dialog', { name: 'Add the video packs' })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/skills/packs/preview')).toBe(true));
    const previewed = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/skills/packs/preview');
    expect(JSON.parse(String(previewed[0]?.[1]?.body))).toEqual({ id: 'openmontage' });

    // An add registers video-use: the panel switches from the search-only branch to the full section.
    rerenderSection({ level: 'global', packs: [pack({ id: 'video-use', skills: [] })], search: 'video' });
    expect(document.querySelector('[data-pack="video-use"]')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Add the video packs' })).toBeTruthy();
    // The same dialog stayed mounted: its previews ran once each, not again after a remount.
    await waitFor(() => expect(document.querySelectorAll('[data-add-pack]')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText('preview failed')).toHaveLength(2));
    const ids = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === '/api/skills/packs/preview')
      .map(([, init]) => (JSON.parse(String(init?.body)) as { id: string }).id);
    expect(ids).toEqual(['openmontage', 'video-use']);
  });

  it('filters available packs by disclosure text', async () => {
    availableBody = { packs: KNOWN_IDS.map(id => availablePack(id)), groups: [VIDEO_GROUP] };
    renderSection({ level: 'global', packs: [pack()], search: 'elevenlabs' });

    await waitFor(() => expect(available('[data-available-pack="video-use"]')).toBeTruthy());
    expect(document.querySelectorAll('[data-available-pack]')).toHaveLength(1);
    expect(available('[data-available-group="video"]')).toBeNull();
  });
});
