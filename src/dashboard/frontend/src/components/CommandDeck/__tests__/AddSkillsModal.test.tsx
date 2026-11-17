/** PAN-5465 WI-8 (FR-11): the Add skills… dialog preselects, posts only changes, and offers Restart and load. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddSkillsModal, outcomeSentence, skillChangeBody } from '../AddSkillsModal';
import type { Conversation } from '../ConversationList';

const CONVERSATION = {
  id: 1,
  name: 'conv-a',
  tmuxSession: 'conv-a',
  status: 'active',
  cwd: '/w',
  issueId: null,
  projectKey: 'tst',
  title: 'Alpha',
  harness: 'claude-code',
} as unknown as Conversation;

const OVERRIDES_BODY = {
  project: 'tst',
  issue: null,
  skills: [],
  packs: [{
    id: 'p',
    skills: [
      { id: 'p/a', enabled: false, source: 'default', description: 'Skill a.' },
      { id: 'p/b', enabled: false, source: 'default', description: 'Skill b.' },
    ],
  }],
};

interface ApplyAnswer {
  outcome: string;
  added: string[];
  warnings: string[];
}

function json(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

function stubFetch(answers: ApplyAnswer[]) {
  let skillMap: Record<string, boolean> = { 'p/a': true };
  const posts: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/skills/overrides')) return json(OVERRIDES_BODY);
    if (url === '/api/conversations/conv-a/skills' && (!init || !init.method || init.method === 'GET')) {
      return json({ conversation: 'conv-a', harness: 'claude-code', running: true, skillOverrides: skillMap });
    }
    if (url === '/api/conversations/conv-a/skills' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { skills?: string[]; off?: string[] };
      posts.push(body);
      const next = { ...skillMap };
      for (const id of body.skills ?? []) next[id] = true;
      for (const id of body.off ?? []) next[id] = false;
      skillMap = next;
      return json(answers.shift() ?? { outcome: 'hot', added: body.skills ?? [], warnings: [] });
    }
    return json({ error: `unexpected ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posts };
}

function renderModal() {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddSkillsModal conversation={CONVERSATION} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function radio(skill: string, choice: 'Inherit' | 'On' | 'Off'): HTMLElement {
  return within(screen.getByRole('radiogroup', { name: skill })).getByRole('radio', { name: choice });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddSkillsModal', () => {
  it('preselects the conversation skill map from GET', async () => {
    const { fetchMock } = stubFetch([]);
    renderModal();
    await screen.findByRole('radiogroup', { name: 'p/a' });
    expect(radio('p/a', 'On').getAttribute('aria-checked')).toBe('true');
    expect(radio('p/b', 'Inherit').getAttribute('aria-checked')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv-a/skills');
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/overrides?project=tst');
  });

  it('keeps submit disabled until something changes, then posts only the changed ids', async () => {
    const { posts } = stubFetch([{ outcome: 'hot', added: ['p/b'], warnings: [] }]);
    renderModal();
    await screen.findByRole('radiogroup', { name: 'p/a' });
    const submit = screen.getByRole('button', { name: 'Add skills' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(radio('p/b', 'On'));
    fireEvent.click(radio('p/a', 'Off'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(await screen.findByText('Added 1 skill to Alpha. They are available now.')).toBeTruthy();
    expect(posts).toEqual([{ skills: ['p/b'], off: ['p/a'] }]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add skills' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('offers Restart and load on needs-restart and re-posts the same body with restart: true', async () => {
    const { posts } = stubFetch([
      { outcome: 'needs-restart', added: ['p/b'], warnings: ['This conversation started before live skill loading; it must restart once.'] },
      { outcome: 'restarted', added: ['p/b'], warnings: [] },
    ]);
    renderModal();
    await screen.findByRole('radiogroup', { name: 'p/b' });
    fireEvent.click(radio('p/b', 'On'));
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));

    expect(await screen.findByText(/must restart to load them/)).toBeTruthy();
    expect(screen.getByText('This conversation started before live skill loading; it must restart once.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart and load' }));

    expect(await screen.findByText('Added 1 skill to Alpha and resumed it.')).toBeTruthy();
    expect(posts).toEqual([{ skills: ['p/b'] }, { skills: ['p/b'], restart: true }]);
    expect(screen.queryByRole('button', { name: 'Restart and load' })).toBeNull();
  });

  it('shows the server error and stays open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/skills/overrides')) return json(OVERRIDES_BODY);
      if (init?.method === 'POST') return json({ error: 'Skill packs apply only to Claude Code and Codex conversations' }, 409);
      return json({ conversation: 'conv-a', harness: 'claude-code', running: true, skillOverrides: { 'p/a': true } });
    }));
    renderModal();
    await screen.findByRole('radiogroup', { name: 'p/b' });
    fireEvent.click(radio('p/b', 'On'));
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
    expect(await screen.findByText('Skill packs apply only to Claude Code and Codex conversations')).toBeTruthy();
  });
});

describe('skillChangeBody', () => {
  it('sends newly On ids as skills, newly Off ids as off, and drops ids cleared to Inherit', () => {
    expect(skillChangeBody({ 'p/a': true, 'p/c': false }, { 'p/a': false, 'p/b': true })).toEqual({ skills: ['p/b'], off: ['p/a'] });
    expect(skillChangeBody({ 'p/a': true }, { 'p/a': true })).toEqual({});
  });
});

describe('outcomeSentence', () => {
  it('words every outcome', () => {
    expect(outcomeSentence('sent', 2, 'Alpha')).toBe('Added 2 skills to Alpha and sent /reload-plugins; the reload was not confirmed. Check the conversation.');
    expect(outcomeSentence('queued', 2, 'Alpha')).toBe('Added 2 skills to Alpha. The reload runs when its current turn ends.');
    expect(outcomeSentence('next-launch', 2, 'Alpha')).toBe('Saved 2 skills on Alpha. They load when it resumes.');
  });
});
