import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../../lib/store';
import { GodViewConfluence } from '../GodViewConfluence';
import type { ConfluenceData, ConfluenceOrb } from '../useConfluenceData';

function orb(id: string, state: ConfluenceOrb['state'], stage: ConfluenceOrb['stage']): ConfluenceOrb {
  return {
    id,
    project: 'overdeck',
    role: 'work',
    stage,
    title: `${id} smoke test orb`,
    heat: .7,
    staleMin: state === 'stale' ? 45 : 0,
    state,
    convoy: null,
    yieldReason: state === 'shelf' ? 'yield: freeing a slot' : null,
    yieldedByScheduler: state === 'shelf',
    warn: null,
    broken: false,
    model: 'claude-sonnet-5',
    harness: 'claude-code',
    labels: [],
    glyph: 'S',
    lastActivity: '2026-08-02T12:00:00.000Z',
    idleMin: state === 'stale' ? 45 : 0,
    waitUntil: 0,
    thinkUntil: 0,
    compactT: 0,
    spend: 0,
    mergeStatus: null,
  };
}

const data: ConfluenceData = {
  orbs: [
    orb('PAN-ACTIVE', 'active', 'PLAN'),
    orb('PAN-SHELF', 'shelf', 'WORK'),
    orb('PAN-STALE', 'stale', 'REVIEW'),
  ],
  hookStream: {
    entries: [],
    eventTimes: [],
    eventsPerMin: 0,
    eventsPerSec: 0,
    specRates: {
      tool_read: 0,
      tool_write: 0,
      tool_exec: 0,
      tool_web: 0,
      tool_agent: 0,
      lifecycle: 0,
    },
    energy: 0,
    microStatesByAgentId: {},
    costEvents: [],
  },
  meta: {
    mergesToday: 0,
    tokensToday: null,
    costPerMin: null,
    mergeQ: 2,
    conversations: 0,
    staleTotal: 1,
    oldestIdle: 45,
    beads: null,
    system: null,
    active: 1,
    total: 3,
    roleCounts: { work: 3 },
  },
};

interface RecordedContext extends Partial<CanvasRenderingContext2D> {
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
}

function canvasContext(): RecordedContext {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => gradient) as unknown as CanvasRenderingContext2D['createLinearGradient'],
    createRadialGradient: vi.fn(() => gradient) as unknown as CanvasRenderingContext2D['createRadialGradient'],
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
  };
}

describe('Confluence canvas smoke test', () => {
  const context = canvasContext();
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-02T12:45:00.000Z'));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind) => {
      if (kind === 'webgl' || kind === 'webgl2') return null;
      return context as CanvasRenderingContext2D;
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    useDashboardStore.setState({
      agentsById: {},
      recentActivity: [],
      observationsByIssueId: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function advanceFrame(timestamp: number): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(timestamp);
  }

  it('renders trails and stage headers with null-WebGL fallback, then picks an orb', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['god-view-activity'], []);
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <GodViewConfluence
          data={data}
          helpOpen={false}
          onHelpOpenChange={vi.fn()}
          onToggleFullscreen={vi.fn()}
        />
      </QueryClientProvider>,
    );

    act(() => advanceFrame(16));

    expect(context.drawImage).toHaveBeenCalled();
    const labels = context.fillText.mock.calls.map(([text]) => text);
    expect(labels).toContain('PLAN');
    expect(labels).toContain('MERGE');
    const glCanvas = container.querySelector<HTMLCanvasElement>('.confluence-gl');
    expect(glCanvas?.style.background).toContain('radial-gradient');

    const issueLabel = context.fillText.mock.calls.find(([text]) => text === 'PAN-ACTIVE');
    const roleLabel = context.fillText.mock.calls.find(([text]) => String(text).startsWith('work ·'));
    expect(issueLabel).toBeDefined();
    expect(roleLabel).toBeDefined();
    const centerX = Number(issueLabel?.[1]);
    const centerY = (Number(issueLabel?.[2]) + Number(roleLabel?.[2])) / 2 - 4;
    const river = screen.getByLabelText('Confluence pipeline river');

    fireEvent.mouseMove(river, { clientX: centerX, clientY: centerY });
    act(() => advanceFrame(32));

    expect(screen.getByText('PAN-ACTIVE smoke test orb')).toBeInTheDocument();
    expect(screen.getByText('PAN-ACTIVE')).toBeInTheDocument();
  });
});
