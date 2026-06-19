import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FolderPicker } from '../FolderPicker.js';

// ─── Mock apiFetch ────────────────────────────────────────────────────────────

vi.mock('../../../lib/apiFetch.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../../../lib/apiFetch.js';
const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

function makeResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

const HOME_DATA = {
  path: '/home/user',
  parent: null,
  entries: [
    { name: 'Projects', path: '/home/user/Projects' },
    { name: 'Documents', path: '/home/user/Documents' },
  ],
};

const PROJECTS_DATA = {
  path: '/home/user/Projects',
  parent: '/home/user',
  entries: [
    { name: 'myapp', path: '/home/user/Projects/myapp' },
  ],
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('FolderPicker', () => {
  it('renders the subdirectory list and current path on mount', async () => {
    mockFetch.mockResolvedValue(makeResponse(HOME_DATA));

    render(<FolderPicker onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user');
    });

    const entries = screen.getAllByTestId('folder-picker-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toBe('Projects/');
    expect(entries[1].textContent).toBe('Documents/');
  });

  it('navigates into a directory when a dir entry is clicked', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(HOME_DATA))
      .mockResolvedValueOnce(makeResponse(PROJECTS_DATA));

    render(<FolderPicker onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('folder-picker-entry')).toHaveLength(2);
    });

    // Click on Projects
    fireEvent.click(screen.getAllByTestId('folder-picker-entry')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user/Projects');
    });

    // The second fetch should have been called with the Projects path (URL-encoded)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('/home/user/Projects')),
      expect.any(Object),
    );
    expect(screen.getAllByTestId('folder-picker-entry')).toHaveLength(1);
    expect(screen.getAllByTestId('folder-picker-entry')[0].textContent).toBe('myapp/');
  });

  it('up button navigates to parent', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(PROJECTS_DATA)) // initial (nested)
      .mockResolvedValueOnce(makeResponse(HOME_DATA));      // after up

    render(<FolderPicker onSelect={vi.fn()} initialPath="/home/user/Projects" />);

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user/Projects');
    });

    fireEvent.click(screen.getByTestId('folder-picker-up'));

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user');
    });
  });

  it('up button is absent at home root (parent=null)', async () => {
    mockFetch.mockResolvedValue(makeResponse(HOME_DATA));
    render(<FolderPicker onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user');
    });

    expect(screen.queryByTestId('folder-picker-up')).toBeNull();
  });

  it('emits onSelect with the current path when Select is clicked', async () => {
    mockFetch.mockResolvedValue(makeResponse(HOME_DATA));
    const onSelect = vi.fn();
    render(<FolderPicker onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByTestId('folder-picker-path').textContent).toBe('/home/user');
    });

    fireEvent.click(screen.getByTestId('folder-picker-select'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('/home/user');
  });
});
