/**
 * Component tests for LegacyImportDialog (PAN-2044).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LegacyImportDialog } from '../LegacyImportDialog.js';

vi.mock('../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

function makeJsonResponse(data: object, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

const PREVIEW_ROW = {
  name: 'my-session',
  title: 'My Session',
  createdAt: '2024-06-01T10:00:00.000Z',
  model: 'claude-opus-4-8',
  alreadyImported: false,
  hasFavorite: false,
  claudeSessionId: null,
  lastActivityAt: null,
  messageCount: null,
};

const ALREADY_IMPORTED_ROW = {
  ...PREVIEW_ROW,
  name: 'existing-session',
  title: 'Existing',
  alreadyImported: true,
};

describe('LegacyImportDialog', () => {
  it('renders nothing when open is false', () => {
    mockFetch.mockResolvedValue(makeJsonResponse({ found: false, defaultPath: '/p', message: 'm' }));
    const { container } = render(<LegacyImportDialog open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows not-found state when preview returns found:false', async () => {
    mockFetch.mockResolvedValue(
      makeJsonResponse({ found: false, defaultPath: '/home/user/.panopticon/panopticon.db', message: 'Not found' }),
    );
    render(<LegacyImportDialog open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Not found/)).toBeTruthy();
    });
    expect(screen.getByTestId('custom-path-input')).toBeTruthy();
  });

  it('shows conversation list with checkboxes on found:true preview', async () => {
    mockFetch.mockResolvedValue(
      makeJsonResponse({ found: true, path: '/p.db', conversations: [PREVIEW_ROW, ALREADY_IMPORTED_ROW] }),
    );
    render(<LegacyImportDialog open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview-rows')).toBeTruthy();
    });

    // Non-imported row: checkbox enabled
    const check = screen.getByTestId('row-checkbox-my-session') as HTMLInputElement;
    expect(check.disabled).toBe(false);
    expect(check.checked).toBe(true);

    // Already-imported row: checkbox disabled + tag
    const disabledCheck = screen.getByTestId('row-checkbox-existing-session') as HTMLInputElement;
    expect(disabledCheck.disabled).toBe(true);
    expect(screen.getByTestId('already-imported-existing-session')).toBeTruthy();
  });

  it('calls POST and shows import summary on confirm', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ found: true, path: '/p.db', conversations: [PREVIEW_ROW] }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          imported: ['my-session'],
          skipped: [],
          failed: [],
          warnings: [],
          favoritesCarried: 0,
        }),
      );

    render(<LegacyImportDialog open={true} onClose={() => {}} />);

    await waitFor(() => screen.getByTestId('import-button'));
    fireEvent.click(screen.getByTestId('import-button'));

    await waitFor(() => {
      expect(screen.getByTestId('import-summary')).toBeTruthy();
    });

    // POST was called with the correct body
    const postCall = mockFetch.mock.calls.find(([url, opts]) => opts?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall![1].body as string);
    expect(body.names).toContain('my-session');
    expect(body.path).toBe('/p.db');
  });

  it('shows error state when POST returns non-ok status', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ found: true, path: '/p.db', conversations: [PREVIEW_ROW] }))
      .mockResolvedValueOnce(makeJsonResponse({ message: 'Unauthorized' }, false));

    render(<LegacyImportDialog open={true} onClose={() => {}} />);

    await waitFor(() => screen.getByTestId('import-button'));
    fireEvent.click(screen.getByTestId('import-button'));

    // Should show the custom-path-input (not-found/error state) rather than crashing or showing summary
    await waitFor(() => {
      expect(screen.queryByTestId('import-summary')).toBeNull();
      expect(screen.getByTestId('custom-path-input')).toBeTruthy();
    });
  });

  it('select-all / select-none controls work', async () => {
    mockFetch.mockResolvedValue(
      makeJsonResponse({ found: true, path: '/p.db', conversations: [PREVIEW_ROW] }),
    );
    render(<LegacyImportDialog open={true} onClose={() => {}} />);

    await waitFor(() => screen.getByTestId('select-none'));
    fireEvent.click(screen.getByTestId('select-none'));

    const check = screen.getByTestId('row-checkbox-my-session') as HTMLInputElement;
    expect(check.checked).toBe(false);

    fireEvent.click(screen.getByTestId('select-all'));
    expect((screen.getByTestId('row-checkbox-my-session') as HTMLInputElement).checked).toBe(true);
  });
});
