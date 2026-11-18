/** PAN-4486 WI-8: the per-conversation skills field of the options dialog. */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/wsTransport')>()),
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import { Modal } from '../../shared/Modal';
import { ConversationSkillsField, summarizeSkills, type ConversationSkillsFieldProps, type SkillGroup } from '../ConversationSkillsField';

const BODY = {
  project: 'tst',
  issue: null,
  skills: [
    { name: 'grilling', core: false, enabled: true, source: 'project', description: 'Grill the plan.', origin: 'project' },
    { name: 'pan-done', core: true, enabled: true, source: 'core', description: 'Finish work.' },
    { name: 'codebase-design', core: false, enabled: false, source: 'global', description: 'Design modules.', origin: 'personal' },
    {
      name: 'acestep', core: false, enabled: true, source: 'default', origin: 'overdeck',
      description: 'AI music generation with ACE-Step 1.5 — background music, vocal tracks, covers, stem extraction for video production.',
    },
  ],
  packs: [{
    id: 'mattpocock',
    skills: [
      { id: 'mattpocock/tdd', enabled: false, source: 'default', description: 'Test first.' },
      { id: 'mattpocock/ask-matt', enabled: false, source: 'default', description: 'Ask Matt a question about TypeScript.' },
    ],
  }],
};

function respond(ok: boolean, body: unknown = BODY) {
  return { ok, status: ok ? 200 : 404, json: async () => body };
}

const NO_AVAILABLE = { packs: [], groups: [] };
const VIDEO = ['remotion', 'hyperframes', 'openmontage', 'video-use'];
const VIDEO_GROUP = {
  name: 'video', packs: VIDEO, source: 'built-in', missing: VIDEO, unknown: [], dashboardAddable: true,
  addCommand: 'pan skills pack add --group video',
};

/** PAN-5540: route by URL; the known-pack listing answers `available`, everything else `overrides`. */
function stubFetch(overrides: (url: string) => ReturnType<typeof respond>, available: unknown = NO_AVAILABLE) {
  const fetchMock = vi.fn(async (url: string) => (url === '/api/skills/packs/available' ? respond(true, available) : overrides(url)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderField(props: Partial<ConversationSkillsFieldProps> = {}) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConversationSkillsField value={{}} onChange={onChange} {...props} />
    </QueryClientProvider>,
  );
  return onChange;
}

function Wrapper({ initial }: { initial: Record<string, boolean> }) {
  const [value, setValue] = useState(initial);
  return <ConversationSkillsField projectKey="tst" value={value} onChange={setValue} />;
}

function renderWrapper(initial: Record<string, boolean>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Wrapper initial={initial} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConversationSkillsField', () => {
  it('renders non-core and pack skills with their inherited state, and hides core skills', async () => {
    stubFetch(() => respond(true));
    renderField({ projectKey: 'tst' });
    fireEvent.click(await screen.findByRole('button', { name: /^Project skills/ }));
    fireEvent.click(screen.getByRole('button', { name: /^mattpocock/ }));
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'pan-done' })).toBeNull();
    expect(screen.getByText('On · project')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/skills/overrides?project=tst');
  });

  it('emits only the explicit choice', async () => {
    stubFetch(() => respond(true));
    const onChange = renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^Project skills/ }));
    const group = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith({ grilling: false });
  });

  it('removes the key when Inherit is chosen', async () => {
    stubFetch(() => respond(true));
    const onChange = renderField({ value: { grilling: false, 'mattpocock/tdd': true } });
    const group = await screen.findByRole('radiogroup', { name: 'grilling' });
    expect(within(group).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Inherit' }));
    expect(onChange).toHaveBeenLastCalledWith({ 'mattpocock/tdd': true });
  });

  it('drops choices for skills the context no longer lists', async () => {
    stubFetch(() => respond(true));
    const onChange = renderField({ value: { grilling: false, gone: true } });
    await screen.findByRole('radiogroup', { name: 'grilling' });
    expect(onChange).toHaveBeenCalledWith({ grilling: false });
  });

  it('refetches without the issue when the issue request fails', async () => {
    const fetchMock = stubFetch(url => respond(!url.includes('issue=')));
    renderField({ projectKey: 'tst', issueId: 'XYZ-1' });
    fireEvent.click(await screen.findByRole('button', { name: /^Project skills/ }));
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
    expect(fetchMock.mock.calls.map(call => call[0]).filter(url => url.startsWith('/api/skills/overrides'))).toEqual([
      '/api/skills/overrides?project=tst&issue=XYZ-1',
      '/api/skills/overrides?project=tst',
    ]);
  });

  it('shows "Skills unavailable" when both requests fail', async () => {
    stubFetch(() => respond(false, { error: 'nope' }));
    renderField({ issueId: 'XYZ-1' });
    expect(await screen.findByText('Skills unavailable')).toBeTruthy();
  });

  it('filters rows by name', async () => {
    stubFetch(() => respond(true));
    renderField();
    await screen.findByRole('button', { name: /^Project skills/ });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'tdd' } });
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeTruthy();
  });

  it('shows the description under the name with the full text in title', async () => {
    stubFetch(() => respond(true));
    renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^Overdeck/ }));
    const row = document.querySelector('[data-skill="acestep"]');
    expect(row).toBeTruthy();
    const description = within(row as HTMLElement).getByText(BODY.skills[3].description);
    expect(description.getAttribute('title')).toBe(BODY.skills[3].description);
  });

  it('shows a pack skill description', async () => {
    stubFetch(() => respond(true));
    renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^mattpocock/ }));
    expect(screen.getByText('Ask Matt a question about TypeScript.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter skills by name or description')).toBeTruthy();
  });

  it('filters rows by description', async () => {
    stubFetch(() => respond(true));
    renderField();
    await screen.findByRole('button', { name: /^Project skills/ });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'music' } });
    expect(screen.getByRole('radiogroup', { name: 'acestep' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeNull();
  });

  it('renders groups collapsed, in order, with on-counts, when there is no filter and no choice', async () => {
    stubFetch(() => respond(true));
    renderField({ projectKey: 'tst' });
    const headers = await screen.findAllByRole('button', { name: /on ·/ });
    expect(headers.map(header => header.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Project skills 1 on · 1',
      'Overdeck 1 on · 1',
      'Personal 0 on · 1',
      'mattpocock 0 on · 2',
    ]);
    for (const header of headers) expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('expands the group that holds a row choice', async () => {
    stubFetch(() => respond(true));
    renderField({ projectKey: 'tst', value: { 'codebase-design': true } });
    const personalHeader = await screen.findByRole('button', { name: /^Personal/ });
    expect(personalHeader.getAttribute('aria-expanded')).toBe('true');
    expect(personalHeader.textContent?.replace(/\s+/g, ' ').trim()).toBe('Personal 1 on · 1');
    const overdeckHeader = screen.getByRole('button', { name: /^Overdeck/ });
    expect(overdeckHeader.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only groups with matches, expanded, while filtering', async () => {
    stubFetch(() => respond(true));
    renderField({ projectKey: 'tst' });
    await screen.findByRole('button', { name: /^Project skills/ });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'music' } });

    const headers = screen.getAllByRole('button', { name: /on ·/ });
    expect(headers).toHaveLength(1);
    expect(headers[0]?.textContent).toContain('Overdeck');
    expect(headers[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(headers[0]).toBeDisabled();
    expect(screen.getByRole('radiogroup', { name: 'acestep' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: '' } });
    const headersAfter = screen.getAllByRole('button', { name: /on ·/ });
    expect(headersAfter).toHaveLength(4);
    for (const header of headersAfter) expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles a group from its header', async () => {
    stubFetch(() => respond(true));
    renderField({ projectKey: 'tst' });
    const header = await screen.findByRole('button', { name: /^Project skills/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
  });

  it('keeps a group open after its last choice returns to Inherit', async () => {
    stubFetch(() => respond(true));
    renderWrapper({ grilling: false });
    const header = await screen.findByRole('button', { name: /^Project skills/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Inherit' }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
  });
  it('offers a pack group that is not added, with Add… opening the add dialog over the parent dialog (PAN-5540)', async () => {
    // Previews fail fast so the dialog's preview loop settles inside the test.
    stubFetch(url => (url === '/api/skills/packs/preview' ? respond(false, { error: 'offline', code: 'git' }) : respond(true)), {
      packs: [],
      groups: [VIDEO_GROUP],
    });
    const parentClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Modal title="New conversation" onClose={parentClose}>
          <ConversationSkillsField projectKey="tst" value={{}} onChange={vi.fn()} />
        </Modal>
      </QueryClientProvider>,
    );

    const row = await waitFor(() => {
      const element = document.querySelector('[data-not-added-group="video"]');
      if (!(element instanceof HTMLElement)) throw new Error('video row not rendered');
      return element;
    });
    expect(row.textContent).toContain('4 packs not added');
    fireEvent.click(within(row).getByRole('button', { name: 'Add the video group' }));

    const dialog = screen.getByRole('dialog', { name: 'Add the video packs' });
    expect(screen.getByRole('dialog', { name: 'New conversation' })).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByText('preview failed')).toHaveLength(4));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Add the video packs' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New conversation' })).toBeTruthy();
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('shows the CLI command for a group the dashboard cannot add', async () => {
    stubFetch(() => respond(true), {
      packs: [],
      groups: [{ ...VIDEO_GROUP, name: 'mine', missing: ['custom-x'], unknown: ['custom-x'], dashboardAddable: false, addCommand: 'pan skills pack add --group mine' }],
    });
    renderField({ projectKey: 'tst' });

    await waitFor(() => expect(document.querySelector('[data-not-added-group="mine"]')).toBeTruthy());
    const row = document.querySelector('[data-not-added-group="mine"]') as HTMLElement;
    expect(row.textContent).toContain('pan skills pack add --group mine');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('hides not-added groups whose name does not match the filter', async () => {
    stubFetch(() => respond(true), { packs: [], groups: [VIDEO_GROUP] });
    renderField({ projectKey: 'tst' });
    await waitFor(() => expect(document.querySelector('[data-not-added-group="video"]')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'tdd' } });
    expect(document.querySelector('[data-not-added-group="video"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'vid' } });
    expect(document.querySelector('[data-not-added-group="video"]')).toBeTruthy();
  });

  it('renders no not-added rows when every group is added', async () => {
    const fetchMock = stubFetch(() => respond(true));
    renderField({ projectKey: 'tst' });
    await screen.findByRole('button', { name: /^Project skills/ });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/skills/packs/available')).toBe(true));

    expect(document.querySelector('[data-not-added-group]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/overrides?project=tst');
  });
});

describe('summarizeSkills', () => {
  const groups: SkillGroup[] = [
    {
      key: 'project',
      label: 'Project skills',
      rows: [
        { id: 'grilling', enabled: true, source: 'project', description: '' },
        { id: 'codebase-design', enabled: false, source: 'global', description: '' },
      ],
    },
  ];

  it('counts inherited and overridden states', () => {
    expect(summarizeSkills(groups, {})).toEqual({ on: 1, total: 2, overrides: 0 });
    // An override false on an enabled row lowers `on`.
    expect(summarizeSkills(groups, { grilling: false })).toEqual({ on: 0, total: 2, overrides: 1 });
    // An override true on a disabled row raises `on`.
    expect(summarizeSkills(groups, { 'codebase-design': true })).toEqual({ on: 2, total: 2, overrides: 1 });
  });
});
