/**
 * PAN-5540 WI-7: the add packs dialog — sequential previews, the trust step,
 * sequential adds with the previewed commit, and the exists / commit-changed
 * answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import { AddPacksDialog } from './AddPacksDialog';
import type { PackPreviewDto } from './availablePacks';

const COMMITS: Record<string, string> = { remotion: '1'.repeat(40), hyperframes: '2'.repeat(40) };

function preview(id: string, commit = COMMITS[id] ?? '9'.repeat(40)): PackPreviewDto {
  return {
    id,
    url: `https://github.com/eltmon/${id}`,
    ref: 'e'.repeat(40),
    commit,
    adapter: 'plain',
    pluginRoot: null,
    license: 'MIT',
    skills: [
      { name: `${id}-rules`, description: 'Rules', optIn: false },
      { name: `${id}-setup`, description: 'Setup', optIn: true },
    ],
    excluded: [],
    notApplied: ['executables (4)'],
    executables: ['a.sh', 'b.sh', 'c.sh', 'd.sh'],
    mcpServers: [{ name: 'docs', url: 'https://docs.example/mcp' }],
    disclosure: `${id} talks to nobody.`,
  };
}

interface Answer {
  status: number;
  body: unknown;
}

type Handler = (id: string, body: Record<string, unknown>) => Answer | Promise<Answer>;

let calls: Array<{ url: string; body: Record<string, unknown> }>;
let onPreview: Handler;
let onAdd: Handler;

beforeEach(() => {
  calls = [];
  onPreview = id => ({ status: 200, body: { preview: preview(id) } });
  onAdd = (id, body) => ({ status: 201, body: { added: true, preview: preview(id, String(body.commit)) } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    const handler = url === '/api/skills/packs/preview' ? onPreview : url === '/api/skills/packs' ? onAdd : null;
    if (!handler) return { ok: true, status: 200, json: async () => ({}) };
    const answer = await handler(String(body.id), body);
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(packIds: string[], onClose = vi.fn(), onAdded = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <AddPacksDialog title="Add the video packs" packIds={packIds} onClose={onClose} onAdded={onAdded} />
    </QueryClientProvider>,
  );
  return { invalidate, onAdded };
}

const row = (id: string) => {
  const element = document.querySelector(`[data-add-pack="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`row ${id} not rendered`);
  return element;
};

const urls = () => calls.map(call => `${call.url} ${String(call.body.id)}`);

describe('AddPacksDialog', () => {
  it('previews packs one at a time in order and shows each preview', async () => {
    let releaseFirst!: () => void;
    onPreview = id =>
      id === 'remotion'
        ? new Promise(resolve => { releaseFirst = () => resolve({ status: 200, body: { preview: preview(id) } }); })
        : { status: 200, body: { preview: preview(id) } };
    renderDialog(['remotion', 'hyperframes']);

    expect(screen.getByRole('dialog', { name: 'Add the video packs' })).toBeTruthy();
    await waitFor(() => expect(urls()).toEqual(['/api/skills/packs/preview remotion']));
    const trust = screen.getByRole('button', { name: /Trust and add/ }) as HTMLButtonElement;
    expect(trust.disabled).toBe(true);
    expect(within(row('remotion')).getByText('Fetching…')).toBeTruthy();

    releaseFirst();
    await waitFor(() => expect(urls()).toEqual(['/api/skills/packs/preview remotion', '/api/skills/packs/preview hyperframes']));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Trust and add 2 packs' }) as HTMLButtonElement).disabled).toBe(false));

    for (const id of ['remotion', 'hyperframes']) {
      const text = row(id).textContent ?? '';
      expect(text).toContain('License');
      expect(text).toContain(`(${COMMITS[id]!.slice(0, 7)})`);
      expect(text).toContain(`${id}-setup`);
      expect(text).toContain('a.sh, b.sh, c.sh, …');
      expect(text).toContain('docs (https://docs.example/mcp)');
      expect(text).toContain('Not applied');
      expect(text).toContain(`${id} talks to nobody.`);
    }
  });

  it('adds each previewed pack with its previewed commit after the trust step', async () => {
    const { invalidate, onAdded } = renderDialog(['remotion', 'hyperframes']);
    const trust = await screen.findByRole('button', { name: 'Trust and add 2 packs' });
    await waitFor(() => expect((trust as HTMLButtonElement).disabled).toBe(false));
    expect(calls.filter(call => call.url === '/api/skills/packs')).toHaveLength(0);

    fireEvent.click(trust);

    await waitFor(() => expect(screen.getByText('Added 2 packs.')).toBeTruthy());
    expect(calls.filter(call => call.url === '/api/skills/packs').map(call => JSON.stringify(call.body))).toEqual([
      `{"id":"remotion","commit":"${COMMITS.remotion}"}`,
      `{"id":"hyperframes","commit":"${COMMITS.hyperframes}"}`,
    ]);
    expect(within(row('remotion')).getByText('added')).toBeTruthy();
    expect(onAdded).toHaveBeenCalledWith(['remotion', 'hyperframes']);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([['skill-overrides'], ['skill-packs-available'], ['new-conversation-skills']]),
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Trust and add/ })).toBeNull();
  });

  it('skips a pack that is already added and counts only the others', async () => {
    onPreview = id =>
      id === 'remotion'
        ? { status: 409, body: { error: 'pack remotion is already registered', code: 'exists' } }
        : { status: 200, body: { preview: preview(id) } };
    renderDialog(['remotion', 'hyperframes']);

    await waitFor(() => expect(within(row('remotion')).getByText('already added')).toBeTruthy());
    const trust = await screen.findByRole('button', { name: 'Trust and add 1 pack' });
    await waitFor(() => expect((trust as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trust);

    await waitFor(() => expect(screen.getByText('Added 1 pack.')).toBeTruthy());
    expect(calls.filter(call => call.url === '/api/skills/packs').map(call => call.body.id)).toEqual(['hyperframes']);
  });

  it('previews a pack again when its commit changed, and lets the operator trust the new commit', async () => {
    const moved = '3'.repeat(40);
    let previews = 0;
    onPreview = id => {
      previews += 1;
      return { status: 200, body: { preview: preview(id, previews === 1 ? COMMITS.remotion : moved) } };
    };
    onAdd = (id, body) =>
      body.commit === moved
        ? { status: 201, body: { added: true, preview: preview(id, moved) } }
        : { status: 409, body: { error: 'pack remotion now resolves to 3333333', code: 'commit-changed' } };
    renderDialog(['remotion']);

    const trust = await screen.findByRole('button', { name: 'Trust and add 1 pack' });
    await waitFor(() => expect((trust as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trust);

    await waitFor(() => expect(within(row('remotion')).getByText('The pack changed since the preview.')).toBeTruthy());
    await waitFor(() => expect(row('remotion').textContent).toContain('(3333333)'));
    expect(urls()).toEqual([
      '/api/skills/packs/preview remotion',
      '/api/skills/packs remotion',
      '/api/skills/packs/preview remotion',
    ]);
    expect(screen.queryByText(/^Added/)).toBeNull();

    const again = screen.getByRole('button', { name: 'Trust and add 1 pack' }) as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(false));
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByText('Added 1 pack.')).toBeTruthy());
    expect(calls.at(-1)?.body).toEqual({ id: 'remotion', commit: moved });
  });

  it('marks a failed preview and retries it', async () => {
    let fail = true;
    onPreview = id =>
      fail ? { status: 502, body: { error: 'fatal: could not read', code: 'git' } } : { status: 200, body: { preview: preview(id) } };
    renderDialog(['remotion']);

    await waitFor(() => expect(within(row('remotion')).getByText('preview failed')).toBeTruthy());
    expect(row('remotion').textContent).toContain('fatal: could not read');
    expect((screen.getByRole('button', { name: 'Trust and add 0 packs' }) as HTMLButtonElement).disabled).toBe(true);

    fail = false;
    fireEvent.click(within(row('remotion')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Trust and add 1 pack' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps going after a failed add and retries that add', async () => {
    let busy = true;
    onAdd = (id, body) =>
      id === 'remotion' && busy
        ? { status: 409, body: { error: 'pack remotion is already being fetched or added', code: 'busy' } }
        : { status: 201, body: { added: true, preview: preview(id, String(body.commit)) } };
    renderDialog(['remotion', 'hyperframes']);

    const trust = await screen.findByRole('button', { name: 'Trust and add 2 packs' });
    await waitFor(() => expect((trust as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trust);

    await waitFor(() => expect(screen.getByText('Added 1 pack.')).toBeTruthy());
    expect(within(row('remotion')).getByText('add failed')).toBeTruthy();
    expect(within(row('hyperframes')).getByText('added')).toBeTruthy();

    busy = false;
    fireEvent.click(within(row('remotion')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Added 2 packs.')).toBeTruthy());
    expect(calls.filter(call => call.url === '/api/skills/packs').map(call => call.body.id)).toEqual(['remotion', 'hyperframes', 'remotion']);
  });
});
