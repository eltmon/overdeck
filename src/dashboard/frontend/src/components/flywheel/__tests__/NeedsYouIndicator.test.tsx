/**
 * PAN-5292 WI-E2 — the top bar's "Needs you · N" button and menu. N is
 * useNeedsYouItems().length (PAN-5287 D-8); the cases before the last mock the
 * selector, and the last runs the real one against a malformed Flywheel body.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NeedsYouItem } from '../../../lib/selectors/needsYou';
import { renderWithQuery, stubFetch } from './fixtures';

const mocks = vi.hoisted(() => ({ items: null as NeedsYouItem[] | null }));

vi.mock('../../../lib/selectors/needsYou', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/selectors/needsYou')>();
  return {
    ...actual,
    // Each test fixes `mocks.items` before rendering, so the hook call order is stable.
    useNeedsYouItems: (opts?: { projectKey?: string }) => mocks.items ?? actual.useNeedsYouItems(opts),
  };
});

// The response cards themselves are covered by DecisionsPanel's tests; here a marker stands in.
vi.mock('../../DecisionsPanel', () => ({
  decisionResponseCard: (d: { id: string; agentRequest?: unknown }) =>
    d.agentRequest ? <div data-testid="mock-response-card"><button type="button">Provide secret {d.id}</button></div> : null,
}));

import { NeedsYouIndicator } from '../NeedsYouIndicator';
import type { Decision } from '../../../lib/useDecisions';

const PROJECTS = [
  { key: 'panopticon-cli', name: 'overdeck', path: '/p/overdeck' },
  { key: 'dfai', name: 'DFAI', path: '/p/dfai' },
];

function item(key: string, overrides: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return { key, kind: 'issue', title: key, ask: `ask for ${key}`, open: vi.fn(), ...overrides };
}

function renderIndicator(items: NeedsYouItem[]) {
  mocks.items = items;
  stubFetch((url) => (url === '/api/registered-projects' ? Response.json(PROJECTS) : undefined));
  return renderWithQuery(<NeedsYouIndicator />);
}

describe('NeedsYouIndicator (PAN-5292 WI-E2)', () => {
  afterEach(() => {
    mocks.items = null;
    vi.unstubAllGlobals();
  });

  it.each([0, 1, 4])('shows the selector count %i, including zero', (n) => {
    renderIndicator(Array.from({ length: n }, (_, i) => item(`issue:PAN-${i + 1}`)));
    const trigger = screen.getByTestId('flywheel-needs-you-indicator');
    expect(trigger).toHaveTextContent(`Needs you · ${n}`);
    expect(trigger).toHaveAttribute('aria-label', `${n} thing${n === 1 ? '' : 's'} need you`);
  });

  it('turns amber only when something needs you', () => {
    const { unmount } = renderIndicator([]);
    const quiet = screen.getByTestId('flywheel-needs-you-indicator');
    expect(quiet.className).not.toMatch(/state-needs-you/);
    expect(screen.getByTestId('needs-you-dot')).toHaveClass('bg-state-waiting');
    unmount();

    renderIndicator([item('issue:PAN-1')]);
    const loud = screen.getByTestId('flywheel-needs-you-indicator');
    expect(loud).toHaveClass('badge-border-state-needs-you', 'badge-bg-state-needs-you');
    expect(screen.getByTestId('needs-you-dot')).toHaveClass('bg-state-needs-you');
  });

  it('opens a row through its own open() once and closes the menu', () => {
    const first = item('issue:PAN-1', { title: 'PAN-1 — First' });
    const second = item('issue:PAN-2', { title: 'PAN-2 — Second' });
    renderIndicator([first, second]);

    fireEvent.click(screen.getByTestId('flywheel-needs-you-indicator'));
    fireEvent.click(screen.getByRole('menuitem', { name: /PAN-2 — Second/ }));

    expect(second.open).toHaveBeenCalledTimes(1);
    expect(first.open).not.toHaveBeenCalled();
    expect(screen.queryByTestId('needs-you-menu')).toBeNull();
  });

  it('groups items under their project display name and puts project-less ones under Other', async () => {
    renderIndicator([
      item('issue:PAN-1', { title: 'PAN-1 — Overdeck work', projectKey: 'panopticon-cli' }),
      item('flywheel:abc', { kind: 'flywheel', title: 'Flywheel', ask: 'decide the scope' }),
      item('conversation:fort', { title: 'Fort 3D', projectKey: 'dfai' }),
    ]);
    fireEvent.click(screen.getByTestId('flywheel-needs-you-indicator'));

    await waitFor(() => expect(screen.getByRole('group', { name: 'overdeck' })).toBeInTheDocument());
    expect(within(screen.getByRole('group', { name: 'overdeck' })).getByText('PAN-1 — Overdeck work')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'DFAI' })).getByText('Fort 3D')).toBeInTheDocument();
    const other = screen.getByRole('group', { name: 'Other' });
    expect(within(other).getByText('Flywheel')).toBeInTheDocument();
    expect(within(other).getByText('decide the scope')).toBeInTheDocument();
    expect(screen.getAllByTestId('needs-you-group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'overdeck',
      'DFAI',
      'Other',
    ]);
  });

  it('renders a decision that has a response card as that card, not a row that opens nothing', () => {
    const request = item('decision:req-1', {
      kind: 'decision',
      title: 'Secret request',
      decision: { id: 'req-1', source: 'agent', agentRequest: { id: 'req-1', kind: 'secret' } } as unknown as Decision,
    });
    const plain = item('issue:PAN-1', { title: 'PAN-1 — Plain' });
    renderIndicator([request, plain]);
    fireEvent.click(screen.getByTestId('flywheel-needs-you-indicator'));

    const menu = screen.getByTestId('needs-you-menu');
    expect(within(menu).getByTestId('mock-response-card')).toHaveTextContent('Provide secret req-1');
    expect(within(menu).getAllByTestId('needs-you-row')).toHaveLength(1);
    expect(within(menu).getByTestId('needs-you-row')).toHaveTextContent('PAN-1 — Plain');

    fireEvent.click(within(menu).getByRole('button', { name: 'Provide secret req-1' }));
    expect(request.open).not.toHaveBeenCalled();
    expect(screen.getByTestId('needs-you-menu')).toBeInTheDocument();
  });

  it('says nothing needs you at zero and opens Activity from the footer', () => {
    window.history.replaceState(null, '', '/');
    renderIndicator([]);
    fireEvent.click(screen.getByTestId('flywheel-needs-you-indicator'));
    expect(screen.getByTestId('needs-you-menu')).toHaveTextContent('Nothing needs you right now.');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Activity' }));
    expect(window.location.pathname).toBe('/activity');
    expect(screen.queryByTestId('needs-you-menu')).toBeNull();
  });

  it('renders "Needs you · 0" with the real selector when the Flywheel answers 200 {}', async () => {
    // It renders in the top bar on every page: a throw here reaches the root
    // error boundary and blanks the whole dashboard (caught by tests/e2e).
    mocks.items = null;
    const fetchMock = stubFetch(() => undefined);
    renderWithQuery(<NeedsYouIndicator />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/flywheel/status')).toBe(true));
    expect(screen.getByTestId('flywheel-needs-you-indicator')).toHaveTextContent('Needs you · 0');
  });
});
