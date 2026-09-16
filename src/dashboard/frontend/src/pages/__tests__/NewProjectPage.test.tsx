import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewProjectPage } from '../NewProjectPage';

// No dashboard state mock needed for this component

// Mock the useProjectCreateIntent hook
const mockSubmit = vi.fn();
// Captures the options the page passes to the hook (mode preset from the URL).
const hookOptionsSpy = vi.hoisted(() => vi.fn());
vi.mock('../../components/project/new/useProjectCreateIntent.js', () => ({
  useProjectCreateIntent: (options: unknown) => (hookOptionsSpy(options), {
    mode: 'clone',
    setMode: vi.fn(),
    url: '',
    setUrl: vi.fn(),
    path: '',
    setPath: vi.fn(),
    parentDir: '',
    setParentDir: vi.fn(),
    name: '',
    setName: vi.fn(),
    issuePrefix: '',
    setIssuePrefix: vi.fn(),
    intent: null,
    stale: false,
    creating: false,
    error: null,
    progress: null,
    canCreate: false,
    findingsFor: () => [],
    submit: mockSubmit,
  }),
}));

// Mock FolderPicker
vi.mock('../../components/inputs/FolderPicker.js', () => ({
  FolderPicker: ({ value, onChange, placeholder }: any) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid="folder-picker"
    />
  ),
}));

describe('NewProjectPage (WI-4)', () => {
  beforeEach(() => {
    mockSubmit.mockClear();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/projects/new');
    vi.clearAllMocks();
  });

  it('renders with three mode tabs', () => {
    render(
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
    );

    expect(screen.getByText('Clone repository')).toBeInTheDocument();
    expect(screen.getByText('Add existing')).toBeInTheDocument();
    expect(screen.getByText('New project')).toBeInTheDocument();
  });

  it('shows the guide line', () => {
    render(
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
    );

    expect(screen.getByText(/A project is a repository with its own issues and pipeline/)).toBeInTheDocument();
  });

  it('renders clone mode fields by default', () => {
    render(
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
    );

    expect(screen.getByPlaceholderText(/https:\/\/github\.com/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('~/Projects')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Project name/)).toBeInTheDocument();
  });

  it('has Cancel and Create buttons', () => {
    render(
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
    );

    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Create project')).toBeInTheDocument();
  });

  it('Cancel button calls onCancel prop', async () => {
    const user = userEvent.setup();
    const mockOnCancel = vi.fn();
    render(
        <NewProjectPage onCancel={mockOnCancel} onCreated={() => {}} />
    );

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('Create button is disabled initially', () => {
    render(
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
    );

    const createButton = screen.getByText('Create project') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });

  it('renders without any <Router> and reads the ?mode= preset from window.location (PAN-3836 UAT)', () => {
    // The dashboard uses hand-rolled routing and never mounts react-router, so the
    // page must not depend on a Router context. UAT caught a useSearchParams crash here.
    window.history.replaceState(null, '', '/projects/new?mode=existing');
    expect(() => render(<NewProjectPage onCancel={() => {}} onCreated={() => {}} />)).not.toThrow();
    expect(hookOptionsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ initialMode: 'existing' }));
  });

  it('defaults the mode preset to clone when ?mode= is absent or invalid', () => {
    window.history.replaceState(null, '', '/projects/new?mode=bogus');
    render(<NewProjectPage onCancel={() => {}} onCreated={() => {}} />);
    expect(hookOptionsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ initialMode: 'clone' }));
  });
});
