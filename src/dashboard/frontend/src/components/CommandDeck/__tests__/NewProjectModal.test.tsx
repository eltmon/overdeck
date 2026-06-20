/**
 * Tests for NewProjectModal — PAN-1970
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NewProjectModal } from '../NewProjectModal.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../lib/apiFetch.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

// The modal attaches the dashboard CSRF header via dashboardMutationJsonHeaders().
// Mock it so the POST carries the header without booting the real session mint.
vi.mock('../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

// FolderPicker renders a simple button. Exactly one is visible at a time
// (only the active mode's picker is mounted), so a single testid is sufficient.
vi.mock('../FolderPicker.js', () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button
      data-testid="mock-folder-picker"
      onClick={() => onSelect('/mock/path')}
    >
      Pick
    </button>
  ),
}));

import { fetchWithTimeout } from '../../../lib/apiFetch.js';
const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

function makeOkResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

function makeErrResponse(status: number, body: object): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NewProjectModal', () => {
  it("renders 'Add existing' toggle active by default and shows the folder picker", () => {
    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByTestId('new-project-tab-existing')).toBeDefined();
    expect(screen.getByTestId('new-project-tab-new')).toBeDefined();
    // Existing mode: folder picker is visible
    expect(screen.getByTestId('mock-folder-picker')).toBeDefined();
    // New mode inputs are not visible
    expect(screen.queryByTestId('new-project-name-input')).toBeNull();
  });

  it("switching to 'New project' tab shows name input and folder picker for parent", () => {
    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByTestId('new-project-tab-new'));

    // Name input appears and picker is still present (for parent)
    expect(screen.getByTestId('new-project-name-input')).toBeDefined();
    expect(screen.getByTestId('mock-folder-picker')).toBeDefined();
  });

  it("new-mode slug preview updates as name changes", async () => {
    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByTestId('new-project-tab-new'));

    // Select a parent via FolderPicker → sets parentDir to '/mock/path'
    fireEvent.click(screen.getByTestId('mock-folder-picker'));

    // Type a name
    fireEvent.change(screen.getByTestId('new-project-name-input'), { target: { value: 'My App' } });

    await waitFor(() => {
      const preview = screen.getByTestId('new-project-preview');
      expect(preview.textContent).toBe('/mock/path/my-app');
    });
  });

  it("clicking Start in existing mode POSTs { mode:'existing', path }", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ key: 'proj', name: 'proj', path: '/mock/path' }));
    const onCreated = vi.fn();
    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={onCreated} />);

    // Select a folder → selectedPath = '/mock/path'
    fireEvent.click(screen.getByTestId('mock-folder-picker'));
    fireEvent.click(screen.getByTestId('new-project-start'));

    await waitFor(() => {
      // Mount also calls fetchWithTimeout for the home dir; filter for the /api/projects POST.
      const projectCalls = mockFetch.mock.calls.filter(([url]) => url === '/api/projects');
      expect(projectCalls).toHaveLength(1);
      const [url, opts] = projectCalls[0] as [string, RequestInit];
      expect(url).toBe('/api/projects');
      // CSRF header must be attached (regression: PAN-1970 modal POSTed without it → 403).
      expect((opts.headers as Record<string, string>)['x-overdeck-csrf-token']).toBe('test-csrf');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ mode: 'existing', path: '/mock/path' });
      expect(onCreated).toHaveBeenCalledWith({ key: 'proj', name: 'proj', path: '/mock/path' });
    });
  });

  it("clicking Start in new mode POSTs { mode:'new', parentDir, name }", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ key: 'my-app', name: 'My App', path: '/mock/path/my-app' }));
    const onCreated = vi.fn();
    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.click(screen.getByTestId('new-project-tab-new'));

    // Select parent dir → parentDir = '/mock/path' (overrides the Overdeck default)
    fireEvent.click(screen.getByTestId('mock-folder-picker'));
    // Type name
    fireEvent.change(screen.getByTestId('new-project-name-input'), { target: { value: 'My App' } });

    fireEvent.click(screen.getByTestId('new-project-start'));

    await waitFor(() => {
      // Mount also calls fetchWithTimeout for the home dir; filter for the /api/projects POST.
      const projectCalls = mockFetch.mock.calls.filter(([url]) => url === '/api/projects');
      expect(projectCalls).toHaveLength(1);
      const [url, opts] = projectCalls[0] as [string, RequestInit];
      expect(url).toBe('/api/projects');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ mode: 'new', parentDir: '/mock/path', name: 'My App' });
    });
  });

  it("new mode default parent is ~/Overdeck when home fetch succeeds", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/fs/list-dirs') {
        return Promise.resolve(makeOkResponse({ path: '/home/testuser', parent: null, entries: [] }));
      }
      return Promise.resolve(makeOkResponse({ key: 'bugs', name: 'Bugs', path: '/home/testuser/Overdeck/bugs' }));
    });

    render(<NewProjectModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByTestId('new-project-tab-new'));

    // Type a name (without selecting a parent) — default parent should already be set
    fireEvent.change(screen.getByTestId('new-project-name-input'), { target: { value: 'Bugs' } });

    await waitFor(() => {
      const preview = screen.getByTestId('new-project-preview');
      expect(preview.textContent).toBe('/home/testuser/Overdeck/bugs');
    });
  });

  it("surfaces server error inline and keeps modal open on non-ok response", async () => {
    mockFetch.mockResolvedValue(makeErrResponse(409, { error: "project key 'my-app' is already registered" }));
    const onClose = vi.fn();
    render(<NewProjectModal isOpen onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByTestId('mock-folder-picker'));
    fireEvent.click(screen.getByTestId('new-project-start'));

    await waitFor(() => {
      const err = screen.getByTestId('new-project-error');
      expect(err.textContent).toContain('already registered');
    });

    // Modal stays open
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-project-modal')).toBeDefined();
  });
});
