import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resize: vi.fn(),
}));

vi.mock('../../../../hooks/useGodViewSocket', () => ({
  useGodViewSocket: vi.fn(),
  useGodViewStore: (selector: (state: { systemHealth: null }) => unknown) => selector({ systemHealth: null }),
}));

vi.mock('../../../../lib/store', () => {
  const state = { agentsById: {}, issuesRaw: [] };
  return {
    selectAgents: (value: typeof state) => Object.values(value.agentsById),
    useDashboardStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('../../Sidebar', () => ({ GodViewSidebar: () => <aside aria-label="God View sidebar" /> }));
vi.mock('../useConfluenceChoreography', () => ({ useConfluenceChoreography: vi.fn(), useSweepChoreography: vi.fn() }));
vi.mock('../useConfluenceData', () => ({
  useConfluenceData: () => ({
    orbs: [],
    hookStream: {
      entries: [],
      eventTimes: [],
      eventsPerMin: 7,
      eventsPerSec: 0,
      specRates: {},
      energy: 0,
      microStatesByAgentId: {},
      costEvents: [],
    },
    meta: {
      mergesToday: 0,
      tokensToday: null,
      costPerMin: null,
      mergeQ: 0,
      conversations: 0,
      staleTotal: 0,
      oldestIdle: 0,
      beads: null,
      system: null,
      active: 0,
      total: 0,
      roleCounts: {},
    },
  }),
}));

vi.mock('../RiverCanvas', async () => {
  const React = await import('react');
  return {
    RiverCanvas: React.forwardRef(function RiverCanvasMock(_props, ref) {
      React.useImperativeHandle(ref, () => ({
        emitSparks: vi.fn(),
        emitRing: vi.fn(),
        emitTicker: vi.fn(),
        playTide: vi.fn(),
        playMerge: vi.fn(),
        playThaw: vi.fn(),
        playSweep: vi.fn(),
        playFlare: vi.fn(),
        pulseSun: vi.fn(),
        spawnFromSun: vi.fn(),
        gateFlash: vi.fn(),
        resize: mocks.resize,
      }));
      return <div data-testid="river-canvas" />;
    }),
  };
});

import { GodViewPage } from '../../index';
import { GodViewConfluence } from '../GodViewConfluence';
import type { ConfluenceData } from '../useConfluenceData';

const confluenceData = {
  orbs: [],
  hookStream: {
    entries: [],
    eventTimes: [],
    eventsPerMin: 7,
    eventsPerSec: 0,
    specRates: {},
    energy: 0,
    microStatesByAgentId: {},
    costEvents: [],
  },
  meta: {
    mergesToday: 0,
    tokensToday: null,
    costPerMin: null,
    mergeQ: 0,
    conversations: 0,
    staleTotal: 0,
    oldestIdle: 0,
    beads: null,
    system: null,
    active: 0,
    total: 0,
    roleCounts: {},
  },
} as unknown as ConfluenceData;

let fullscreenElement: Element | null;
let requestedElement: Element | null;
let requestFullscreen: ReturnType<typeof vi.fn>;
let exitFullscreen: ReturnType<typeof vi.fn>;

const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
const requestDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else delete (target as Record<string, unknown>)[key];
}

beforeEach(() => {
  fullscreenElement = null;
  requestedElement = null;
  requestFullscreen = vi.fn();
  exitFullscreen = vi.fn(() => Promise.resolve());
  mocks.resize.mockClear();

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value(this: HTMLElement) {
      requestedElement = this;
      requestFullscreen();
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  restoreProperty(document, 'fullscreenElement', fullscreenDescriptor);
  restoreProperty(document, 'exitFullscreen', exitDescriptor);
  restoreProperty(HTMLElement.prototype, 'requestFullscreen', requestDescriptor);
});

describe('GodViewConfluence field guide and fullscreen controls', () => {
  it('toggles the complete field guide with h, ?, Escape, and the top-bar help button', () => {
    render(<GodViewPage />);

    const openWithH = new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true });
    fireEvent(window, openWithH);
    expect(openWithH.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Confluence field guide' })).toBeInTheDocument();

    for (const heading of [
      'The River',
      'Issue Orbs & Model Glyphs',
      'Hook Sparks',
      'Agent Micro-States',
      'Review Convoys',
      'The Shelf & Governor Tides',
      'Frost & The Doldrums',
      'Merge Portal & Wrecks',
      'Flywheel Sun & Sequencer',
      'Conversation Constellation',
      'Hook Bus · Dark Fiber',
      'Hook Telemetry',
      'Sidebar',
      'Data Honesty',
      'Keys & Mouse',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/MERGE shows its queue depth/)).toBeInTheDocument();
    expect(screen.getByText(/Hovering a feed row flashes the matching orb/)).toBeInTheDocument();
    const dataHonestyCard = screen.getByRole('heading', { name: 'Data Honesty' }).closest('.h-card');
    expect(dataHonestyCard).toHaveTextContent('The cast is real');
    expect(dataHonestyCard).toHaveTextContent('The motion is real');
    expect(dataHonestyCard).toHaveTextContent('dashboard snapshot + /ws/rpc domain events');
    expect(dataHonestyCard).toHaveTextContent('current 60-second window contains 7 events');

    fireEvent.keyDown(window, { key: 'h' });
    expect(screen.queryByRole('dialog', { name: 'Confluence field guide' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Confluence field guide' })).toBeInTheDocument();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(window, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Confluence field guide' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Confluence field guide' }));
    expect(screen.getByRole('dialog', { name: 'Confluence field guide' })).toBeInTheDocument();
  });

  it('toggles the God View root fullscreen from f and the top-bar button', () => {
    const { container } = render(<GodViewPage />);
    const root = container.querySelector('.god-view');
    expect(root).not.toBeNull();

    const f = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    fireEvent(window, f);
    expect(f.defaultPrevented).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestedElement).toBe(root);

    fullscreenElement = root;
    fireEvent.click(screen.getByRole('button', { name: 'Toggle God View fullscreen' }));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('relayouts after fullscreenchange and removes its global handlers on unmount', () => {
    vi.useFakeTimers();
    const onHelpOpenChange = vi.fn();
    const onToggleFullscreen = vi.fn();
    const { unmount } = render(
      <GodViewConfluence
        data={confluenceData}
        helpOpen={false}
        onHelpOpenChange={onHelpOpenChange}
        onToggleFullscreen={onToggleFullscreen}
      />,
    );

    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
      vi.advanceTimersByTime(120);
    });
    expect(mocks.resize).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(window, { key: 'h' });
    document.dispatchEvent(new Event('fullscreenchange'));
    vi.advanceTimersByTime(120);
    expect(onHelpOpenChange).not.toHaveBeenCalled();
    expect(mocks.resize).toHaveBeenCalledTimes(1);
  });

  it('leaves shortcuts and default browser behavior alone while a modal or text field has focus', () => {
    render(
      <>
        <GodViewPage />
        <div role="dialog" aria-modal="true" aria-label="Other modal">
          <input aria-label="Modal input" />
        </div>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Confluence field guide' }));
    const closeHelp = screen.getByRole('button', { name: 'Close field guide' });
    closeHelp.focus();
    const helpFocusedShortcut = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    fireEvent(closeHelp, helpFocusedShortcut);
    expect(helpFocusedShortcut.defaultPrevented).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
    fireEvent.click(closeHelp);

    const input = screen.getByRole('textbox', { name: 'Modal input' });
    input.focus();
    const blockedHelp = new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true });
    fireEvent(input, blockedHelp);
    expect(blockedHelp.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Confluence field guide' })).not.toBeInTheDocument();

    const blockedFullscreen = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    fireEvent(input, blockedFullscreen);
    expect(blockedFullscreen.defaultPrevented).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();

    input.blur();
    const unrelated = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    fireEvent(window, unrelated);
    expect(unrelated.defaultPrevented).toBe(false);
  });
});
