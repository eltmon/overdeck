import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectNode, type ProjectFeature } from './ProjectNode';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';

vi.mock('lucide-react', () => ({
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="project-chevron" {...props} />,
  MessageSquarePlus: () => <svg data-testid="message-square-plus" />,
  Circle: () => <svg data-testid="circle-icon" />,
  Archive: () => <svg data-testid="archive-icon" />,
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  X: () => <svg data-testid="x-icon" />,
  Pencil: () => <svg data-testid="pencil-icon" />,
  Star: () => <svg data-testid="star-icon" />,
  Loader2: () => <svg data-testid="loader2-icon" />,
  Terminal: () => <svg data-testid="terminal-icon" />,
  FileCode: () => <svg data-testid="filecode-icon" />,
  Search: () => <svg data-testid="search-icon" />,
  Globe: () => <svg data-testid="globe-icon" />,
  Wrench: () => <svg data-testid="wrench-icon" />,
  Zap: () => <svg data-testid="zap-icon" />,
  GitBranchPlus: () => <svg data-testid="gitbranchplus-icon" />,
  AlertCircle: () => <svg data-testid="alertcircle-icon" />,
}));

vi.mock('./FeatureItem', () => ({
  FeatureItem: ({ feature }: { feature: ProjectFeature }) => <div data-testid={`feature-${feature.issueId}`}>{feature.issueId}</div>,
  sessionMatchesFilter: (session: SessionNodeType, filter: 'all' | 'alive' | 'failed') => {
    if (filter === 'all') return true;
    if (filter === 'alive') return session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
    const status = (session.status || '').toLowerCase();
    return status.includes('fail') || status.includes('error') || status.includes('stuck');
  },
}));

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    projectNode: 'projectNode',
    projectHeader: 'projectHeader',
    chevron: 'chevron',
    chevronOpen: 'chevronOpen',
    projectName: 'projectName',
    featureCount: 'featureCount',
    projectAddConvBtn: 'projectAddConvBtn',
    emptyProject: 'emptyProject',
  },
}));

function render(ui: Parameters<typeof rtlRender>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...rtlRender(ui, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }),
    queryClient,
  };
}

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-854',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

function makeFeature(issueId: string, sessions?: SessionNodeType[]): ProjectFeature {
  return {
    issueId,
    title: issueId,
    projectName: 'overdeck',
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'running',
    stateLabel: 'In Progress',
    agentStatus: 'active',
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    sessions,
  };
}

describe('ProjectNode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only alive features when alive filter is active', () => {
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[
          makeFeature('PAN-854', [makeSession({ presence: 'active', status: 'running' })]),
          makeFeature('PAN-855', [makeSession({ presence: 'ended', status: 'stopped' })]),
        ]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        filter="alive"
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-PAN-854')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-PAN-855')).not.toBeInTheDocument();
  });

  it('shows only failed features when failed filter is active', () => {
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[
          makeFeature('PAN-854', [makeSession({ presence: 'active', status: 'running' })]),
          makeFeature('PAN-855', [makeSession({ presence: 'ended', status: 'error' })]),
        ]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        filter="failed"
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-PAN-855')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-PAN-854')).not.toBeInTheDocument();
  });

  it('clicking the chevron toggles expansion without selecting the project', () => {
    const onSelectProject = vi.fn();

    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[makeFeature('PAN-854')]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByTestId('project-chevron'));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('feature-PAN-854')).not.toBeInTheDocument();
  });

  it('clicking the project row selects the project and expands if collapsed', () => {
    const onSelectProject = vi.fn();

    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        onSelectProject={onSelectProject}
      />,
    );

    expect(screen.queryByText('(no active features)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /overdeck/i }));

    expect(onSelectProject).toHaveBeenCalledWith('overdeck');
    expect(screen.getByText('(no active features)')).toBeInTheDocument();
  });

  it('applies selected project background and preserves MessageSquarePlus stopPropagation', () => {
    const onSelectProject = vi.fn();
    const onNewConversation = vi.fn();

    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[makeFeature('PAN-854')]}
        selectedFeature={null}
        selectedProject="overdeck"
        onSelectFeature={() => {}}
        onSelectProject={onSelectProject}
        onNewConversation={onNewConversation}
      />,
    );

    const row = screen.getAllByRole('button', { name: /overdeck/i })[0];
    expect(row).toHaveStyle({ background: 'var(--accent)' });

    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));

    expect(onNewConversation).toHaveBeenCalledWith('overdeck');
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it('offers project rename from the context menu', () => {
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[]}
        selectedFeature={null}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /overdeck/i }));

    expect(screen.getByRole('button', { name: 'Rename project' })).toBeInTheDocument();
  });

  it('opens a selected inline editor without selecting or collapsing the project', async () => {
    const onSelectProject = vi.fn();
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[makeFeature('PAN-854')]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /overdeck/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));

    const input = screen.getByRole('textbox', { name: 'Rename overdeck' }) as HTMLInputElement;
    expect(input).toHaveValue('overdeck');
    expect(screen.getByTestId('feature-PAN-854')).toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('overdeck'.length);
    });
  });

  it('posts an Enter rename once and invalidates project-name queries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 'overdeck', name: 'Overdeck App' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = render(
      <ProjectNode
        projectKey="overdeck"
        name="Overdeck CLI"
        features={[]}
        selectedFeature={null}
        onSelectFeature={() => {}}
      />,
    );
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.contextMenu(screen.getByRole('button', { name: /overdeck cli/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    const input = screen.getByRole('textbox', { name: 'Rename Overdeck CLI' });
    fireEvent.change(input, { target: { value: 'Overdeck App' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/overdeck/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Overdeck App' }),
      });
    });
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['registered-projects'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['session-trees'] });
    });
  });

  it('cancels an inline rename on Escape without sending a request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[]}
        selectedFeature={null}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /overdeck/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename overdeck' }), {
      key: 'Escape',
    });

    expect(screen.queryByRole('textbox', { name: 'Rename overdeck' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the inline editor and draft after a rename error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Project name 'Krux' conflicts with existing project 'krux'" }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    render(
      <ProjectNode
        projectKey="overdeck"
        name="overdeck"
        features={[]}
        selectedFeature={null}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /overdeck/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    const input = screen.getByRole('textbox', { name: 'Rename overdeck' });
    fireEvent.change(input, { target: { value: 'Krux' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Project name 'Krux' conflicts with existing project 'krux'",
    );
    expect(screen.getByRole('textbox', { name: 'Rename overdeck' })).toHaveValue('Krux');
    expect(screen.getByRole('textbox', { name: 'Rename overdeck' }).closest('button')).toHaveAttribute(
      'title',
      "Project name 'Krux' conflicts with existing project 'krux'",
    );
  });
});
