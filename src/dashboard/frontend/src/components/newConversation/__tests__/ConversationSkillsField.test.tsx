/** PAN-4486 WI-8: the per-conversation skills field of the options dialog. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationSkillsField, type ConversationSkillsFieldProps } from '../ConversationSkillsField';

const BODY = {
  project: 'tst',
  issue: null,
  skills: [
    { name: 'grilling', core: false, enabled: true, source: 'project', description: 'Grill the plan.' },
    { name: 'pan-done', core: true, enabled: true, source: 'core', description: 'Finish work.' },
    { name: 'codebase-design', core: false, enabled: false, source: 'global', description: 'Design modules.' },
    {
      name: 'acestep', core: false, enabled: true, source: 'default',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConversationSkillsField', () => {
  it('renders non-core and pack skills with their inherited state, and hides core skills', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField({ projectKey: 'tst' });
    expect(await screen.findByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'pan-done' })).toBeNull();
    expect(screen.getByText('On · project')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/skills/overrides?project=tst');
  });

  it('emits only the explicit choice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    const onChange = renderField();
    const group = await screen.findByRole('radiogroup', { name: 'grilling' });
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
    expect(await screen.findByRole('radiogroup', { name: 'grilling' })).toBeTruthy();
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
    await screen.findByRole('radiogroup', { name: 'grilling' });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'tdd' } });
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeTruthy();
  });

  it('shows the description under the name with the full text in title', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    await screen.findByRole('radiogroup', { name: 'grilling' });
    const row = document.querySelector('[data-skill="acestep"]');
    expect(row).toBeTruthy();
    const description = within(row as HTMLElement).getByText(BODY.skills[3].description);
    expect(description.getAttribute('title')).toBe(BODY.skills[3].description);
  });

  it('shows a pack skill description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    await screen.findByRole('radiogroup', { name: 'grilling' });
    expect(screen.getByText('Ask Matt a question about TypeScript.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter skills by name or description')).toBeTruthy();
  });

  it('filters rows by description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(true)));
    renderField();
    await screen.findByRole('radiogroup', { name: 'grilling' });
    fireEvent.change(screen.getByLabelText('Filter skills'), { target: { value: 'music' } });
    expect(screen.getByRole('radiogroup', { name: 'acestep' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'grilling' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'mattpocock/tdd' })).toBeNull();
  });
});
