/** PAN-4486 WI-8: the per-conversation skills field of the options dialog. */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationSkillsField, type ConversationSkillsFieldProps } from '../ConversationSkillsField';

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
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
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
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    const onChange = renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^Project skills/ }));
    const group = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith({ grilling: false });
  });

  it('removes the key when Inherit is chosen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    const onChange = renderField({ value: { grilling: false, 'mattpocock/tdd': true } });
    const group = await screen.findByRole('radiogroup', { name: 'grilling' });
    expect(within(group).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Inherit' }));
    expect(onChange).toHaveBeenLastCalledWith({ 'mattpocock/tdd': true });
  });

  it('drops choices for skills the context no longer lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    const onChange = renderField({ value: { grilling: false, gone: true } });
    await screen.findByRole('radiogroup', { name: 'grilling' });
    expect(onChange).toHaveBeenCalledWith({ grilling: false });
  });

  it('refetches without the issue when the issue request fails', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(!url.includes('issue=')));
    vi.stubGlobal('fetch', fetchMock);
    renderField({ projectKey: 'tst', issueId: 'XYZ-1' });
    fireEvent.click(await screen.findByRole('button', { name: /^Project skills/ }));
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/skills/overrides?project=tst&issue=XYZ-1',
      '/api/skills/overrides?project=tst',
    ]);
  });

  it('shows "Skills unavailable" when both requests fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(false, { error: 'nope' })));
    renderField({ issueId: 'XYZ-1' });
    expect(await screen.findByText('Skills unavailable')).toBeTruthy();
  });

  it('filters rows by name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    await screen.findByRole('button', { name: /^Project skills/ });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'tdd' } });
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeTruthy();
  });

  it('shows the description under the name with the full text in title', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^Overdeck/ }));
    const row = document.querySelector('[data-skill="acestep"]');
    expect(row).toBeTruthy();
    const description = within(row as HTMLElement).getByText(BODY.skills[3].description);
    expect(description.getAttribute('title')).toBe(BODY.skills[3].description);
  });

  it('shows a pack skill description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    fireEvent.click(await screen.findByRole('button', { name: /^mattpocock/ }));
    expect(screen.getByText('Ask Matt a question about TypeScript.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter skills by name or description')).toBeTruthy();
  });

  it('filters rows by description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    await screen.findByRole('button', { name: /^Project skills/ });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'music' } });
    expect(screen.getByRole('radiogroup', { name: 'acestep' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeNull();
  });

  it('renders groups collapsed, in order, with on-counts, when there is no filter and no choice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
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
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField({ projectKey: 'tst', value: { 'codebase-design': true } });
    const personalHeader = await screen.findByRole('button', { name: /^Personal/ });
    expect(personalHeader.getAttribute('aria-expanded')).toBe('true');
    expect(personalHeader.textContent?.replace(/\s+/g, ' ').trim()).toBe('Personal 1 on · 1');
    const overdeckHeader = screen.getByRole('button', { name: /^Overdeck/ });
    expect(overdeckHeader.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only groups with matches, expanded, while filtering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
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
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
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
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderWrapper({ grilling: false });
    const header = await screen.findByRole('button', { name: /^Project skills/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Inherit' }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
  });
});
