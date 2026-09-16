import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { NewProjectPage } from '../NewProjectPage';

// No dashboard state mock needed for this component

// Mock the useProjectCreateIntent hook
const mockSubmit = vi.fn();
vi.mock('../../components/project/new/useProjectCreateIntent.js', () => ({
  useProjectCreateIntent: () => ({
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
    vi.clearAllMocks();
  });

  it('renders with three mode tabs', () => {
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByText('Clone repository')).toBeInTheDocument();
    expect(screen.getByText('Add existing')).toBeInTheDocument();
    expect(screen.getByText('New project')).toBeInTheDocument();
  });

  it('shows the guide line', () => {
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByText(/A project is a repository with its own issues and pipeline/)).toBeInTheDocument();
  });

  it('renders clone mode fields by default', () => {
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByPlaceholderText(/https:\/\/github\.com/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('~/Projects')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Project name/)).toBeInTheDocument();
  });

  it('has Cancel and Create buttons', () => {
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Create project')).toBeInTheDocument();
  });

  it('Cancel button calls onCancel prop', async () => {
    const user = userEvent.setup();
    const mockOnCancel = vi.fn();
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={mockOnCancel} onCreated={() => {}} />
      </BrowserRouter>
    );

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('Create button is disabled initially', () => {
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    const createButton = screen.getByText('Create project') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });
});
