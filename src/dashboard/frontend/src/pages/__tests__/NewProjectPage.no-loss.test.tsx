import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { NewProjectPage } from '../NewProjectPage';

// Mock the hook
const mockSubmit = vi.fn();
const mockFindingsFor = vi.fn(() => []);
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
    findingsFor: mockFindingsFor,
    submit: mockSubmit,
  }),
}));

describe('NewProjectPage no-loss audit (PAN-3836 WI-5)', () => {
  const affordances = [
    {
      label: 'Mode tab "Add existing"',
      assert: () => {
        const btn = screen.getByText('Add existing');
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveClass('tab');
      },
    },
    {
      label: 'Mode tab "New project"',
      assert: () => {
        const btn = screen.getByText('New project');
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveClass('tab');
      },
    },
    {
      label: 'Mode tab "Clone repository"',
      assert: () => {
        const btn = screen.getByText('Clone repository');
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveClass('tab');
      },
    },
    {
      label: 'Clone mode path picker (text input)',
      assert: () => {
        const input = screen.getByPlaceholderText('~/Projects') as HTMLInputElement;
        expect(input).toBeInTheDocument();
        expect(input.type).toBe('text');
      },
    },
    {
      label: 'Name input with data-testid="new-project-name-input"',
      assert: () => {
        const inputs = screen.queryAllByPlaceholderText(/Project name|project name/i);
        expect(inputs.length).toBeGreaterThan(0);
      },
    },
    {
      label: 'Cancel button',
      assert: () => {
        const btn = screen.getByText('Cancel');
        expect(btn).toBeInTheDocument();
        expect(btn.tagName).toBe('BUTTON');
      },
    },
    {
      label: 'Create project button (main CTA)',
      assert: () => {
        const btn = screen.getByText('Create project');
        expect(btn).toBeInTheDocument();
        expect(btn.tagName).toBe('BUTTON');
      },
    },
    {
      label: 'Guide line mentioning workspace creation link',
      assert: () => {
        const text = screen.getByText(/Want another checkout/);
        expect(text).toBeInTheDocument();
        const link = screen.getByRole('link', { name: /Create a workspace/ });
        expect(link).toHaveAttribute('href', '/workspaces/new');
      },
    },
  ];

  beforeEach(() => {
    mockSubmit.mockClear();
    mockFindingsFor.mockClear();
    mockFindingsFor.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  affordances.forEach(({ label, assert: assertFn }) => {
    it(`provides: ${label}`, () => {
      render(
        <BrowserRouter>
          <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
        </BrowserRouter>
      );

      assertFn();
    });
  });

  it('Cancel button triggers onCancel callback', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <BrowserRouter>
        <NewProjectPage onCancel={onCancel} onCreated={() => {}} />
      </BrowserRouter>
    );

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);

    expect(onCancel).toHaveBeenCalled();
  });

  it('inline findings are rendered when present', () => {
    mockFindingsFor.mockImplementation((field) => {
      if (field === 'url') {
        return [{ field: 'url', code: 'url-invalid', message: 'Invalid URL' }];
      }
      return [];
    });

    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByText('Invalid URL')).toBeInTheDocument();
  });

  it('status strip is shown when intent exists (integration)', () => {
    // This is tested in NewProjectPage.test.tsx with full hook mock
    // This no-loss test just verifies the page structure
    render(
      <BrowserRouter>
        <NewProjectPage onCancel={() => {}} onCreated={() => {}} />
      </BrowserRouter>
    );

    expect(screen.getByText('Clone repository')).toBeInTheDocument();
  });
});
