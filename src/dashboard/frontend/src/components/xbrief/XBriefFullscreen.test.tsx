import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspacePlanQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useDashboardStore } from '../../lib/store';
import { XBriefFullscreen } from './XBriefFullscreen';
import type { XBriefDocument, XBriefInspectionPolicy } from './types';

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useWorkspacePlanQuery: vi.fn(),
}));

vi.mock('./XBriefViewer', () => ({
  XBriefViewer: ({ doc, activeTab, showTabBar, onInspectionPolicyChange }: {
    doc: XBriefDocument | null;
    activeTab?: string;
    showTabBar?: boolean;
    onInspectionPolicyChange?: (policy: XBriefInspectionPolicy) => void;
  }) => (
    <div
      data-testid="xbrief-viewer"
      data-plan-id={doc?.plan.id ?? ''}
      data-active-tab={activeTab}
      data-show-tab-bar={String(showTabBar)}
    >
      <button type="button" onClick={() => onInspectionPolicyChange?.('never')}>
        Disable inspection
      </button>
    </div>
  ),
}));

const doc: XBriefDocument = {
  xBRIEFInfo: {
    version: '0.8',
    created: '2026-07-28T00:00:00Z',
  },
  plan: {
    id: 'pan-3231',
    title: 'Artifact viewers',
    status: 'running',
    items: [
      { id: 'done', title: 'Done', status: 'completed' },
      { id: 'running', title: 'Running', status: 'running' },
      { id: 'ready', title: 'Ready', status: 'pending' },
      { id: 'waiting', title: 'Waiting', status: 'pending' },
    ],
    edges: [{ from: 'running', to: 'waiting', type: 'blocks' }],
  },
};

function installPlanQuery(data: XBriefDocument | null = doc) {
  vi.mocked(useWorkspacePlanQuery).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useWorkspacePlanQuery>);
}

function renderViewer(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return {
    queryClient,
    ...render(<XBriefFullscreen />, { wrapper: Wrapper }),
  };
}

beforeEach(() => {
  useDashboardStore.setState({ xbriefViewerIssueId: null });
  installPlanQuery();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('XBriefFullscreen', () => {
  it('renders the shared List, DAG, and Raw viewer in a focused modal dialog', () => {
    useDashboardStore.getState().openXbriefViewer('PAN-3231');

    renderViewer();

    const dialog = screen.getByRole('dialog', { name: 'PAN-3231 Artifact viewers' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(screen.getByText('xBRIEF · active plan')).toBeInTheDocument();
    expect(screen.getByText('PAN-3231')).toBeInTheDocument();
    expect(screen.getByText('Artifact viewers')).toBeInTheDocument();
    expect(screen.getByTestId('xbrief-viewer')).toHaveAttribute('data-plan-id', 'pan-3231');
    expect(screen.getByTestId('xbrief-viewer')).toHaveAttribute('data-show-tab-bar', 'false');
    expect(screen.getByRole('tab', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'DAG' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Raw' })).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByText(/happening now/)).toHaveTextContent('1 happening now');
    expect(screen.getByText(/ready/)).toHaveTextContent('1 ready');
    expect(screen.getByText(/waiting on edges/)).toHaveTextContent('1 waiting on edges');
    expect(screen.getByText(/execution lanes/)).toHaveTextContent('2 execution lanes');
    expect(screen.getByText('esc')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'DAG' }));
    expect(screen.getByTestId('xbrief-viewer')).toHaveAttribute('data-active-tab', 'dag');
    expect(useWorkspacePlanQuery).toHaveBeenCalledWith('PAN-3231', { enabled: true });
  });

  it('closes from Escape and the scrim but not from clicks inside the panel', () => {
    useDashboardStore.getState().openXbriefViewer('PAN-3231');
    const firstRender = renderViewer();

    fireEvent.click(screen.getByRole('dialog', { name: 'PAN-3231 Artifact viewers' }));
    expect(useDashboardStore.getState().xbriefViewerIssueId).toBe('PAN-3231');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDashboardStore.getState().xbriefViewerIssueId).toBeNull();

    firstRender.unmount();
    useDashboardStore.getState().openXbriefViewer('PAN-3231');
    renderViewer();
    fireEvent.click(screen.getByTestId('xbrief-fullscreen-scrim'));
    expect(useDashboardStore.getState().xbriefViewerIssueId).toBeNull();
  });

  it('writes inspection-policy updates into the canonical workspace-plan cache key', async () => {
    const updated = {
      ...doc,
      xBRIEFInfo: { ...doc.xBRIEFInfo, inspectionPolicy: 'never' as const },
    };
    const fetchMock = vi.fn(async () => Response.json(updated));
    vi.stubGlobal('fetch', fetchMock);
    useDashboardStore.getState().openXbriefViewer('PAN-3231');
    const { queryClient } = renderViewer();

    fireEvent.click(screen.getByRole('button', { name: 'Disable inspection' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(['workspace-plan', 'PAN-3231'])).toEqual(updated);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/PAN-3231/plan/inspection-policy',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
