import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ConversationSearchActivitySnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { SETTINGS_SECTION_EVENT } from '../../lib/settingsSection';
import { ConversationSearchIndexingIndicator } from './ConversationSearchIndexingIndicator';

function snapshot(overrides: Partial<ConversationSearchActivitySnapshot> = {}): ConversationSearchActivitySnapshot {
  return {
    active: true,
    kind: 'full-reindex',
    filesScanned: 10,
    filesIndexed: 3,
    chunksIndexed: 42,
    currentFile: 'session-abc.jsonl',
    queued: 2,
    inFlight: 1,
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    endedAt: null,
    lastError: null,
    lastErrorAt: null,
    ...overrides,
  }
}

function seed(value: ConversationSearchActivitySnapshot | null) {
  act(() => {
    useDashboardStore.setState({ conversationSearchActivity: value })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  seed(null)
  act(() => {
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
})

describe('ConversationSearchIndexingIndicator (PAN-5609 WI-6)', () => {
  it('renders nothing when idle (no snapshot yet)', () => {
    seed(null)
    render(<ConversationSearchIndexingIndicator />)
    expect(screen.queryByTestId('conversation-search-indexing-indicator')).toBeNull()
  })

  it('renders nothing for an inactive snapshot', () => {
    seed(snapshot({ active: false, endedAt: new Date().toISOString() }))
    render(<ConversationSearchIndexingIndicator />)
    expect(screen.queryByTestId('conversation-search-indexing-indicator')).toBeNull()
  })

  it('renders the chip with the file count for an active full-reindex snapshot', () => {
    seed(snapshot())
    render(<ConversationSearchIndexingIndicator />)
    const chip = screen.getByTestId('conversation-search-indexing-indicator')
    expect(chip.textContent).toContain('Indexing 3/10')
  })

  it('shows a tooltip on hover and focus, hides it on mouseLeave', () => {
    seed(snapshot())
    render(<ConversationSearchIndexingIndicator />)
    const chip = screen.getByTestId('conversation-search-indexing-indicator')

    fireEvent.mouseEnter(chip)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Full reindex')
    expect(tooltip.textContent).toContain('3/10 files')
    expect(tooltip.textContent).toContain('42 chunks')
    expect(tooltip.textContent).toContain('Running for')

    fireEvent.mouseLeave(chip)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(chip)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('opens a dialog on click with current file, queued, in-flight and last-error rows; suppresses the tooltip; closes on Escape', () => {
    seed(snapshot({ lastError: 'embedding provider down' }))
    render(<ConversationSearchIndexingIndicator />)
    const chip = screen.getByTestId('conversation-search-indexing-indicator')

    fireEvent.mouseEnter(chip)
    expect(screen.getByRole('tooltip')).toBeTruthy()

    fireEvent.click(chip)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('session-abc.jsonl')
    expect(dialog.textContent).toContain('Queued')
    expect(dialog.textContent).toContain('In flight')
    expect(dialog.textContent).toContain('embedding provider down')
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls onOpenSettings and dispatches the settings-section event when the footer link is clicked', () => {
    seed(snapshot())
    const onOpenSettings = vi.fn()
    render(<ConversationSearchIndexingIndicator onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByTestId('conversation-search-indexing-indicator'))

    const listener = vi.fn()
    window.addEventListener(SETTINGS_SECTION_EVENT, listener)
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation search settings' }))
    window.removeEventListener(SETTINGS_SECTION_EVENT, listener)

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBe('conversation-search')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
