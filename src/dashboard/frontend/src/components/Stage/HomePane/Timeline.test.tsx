import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timeline } from './Timeline'

const NOW = new Date('2026-05-28T12:00:00Z').getTime()
const DAY = 86_400_000

describe('Timeline', () => {
  it('renders conversations grouped by date with agent, time, and preview', () => {
    render(
      <Timeline
        now={NOW}
        onOpen={() => {}}
        conversations={[
          { id: 'a', agentLabel: 'Claude Code', timestamp: NOW - 5 * 60_000, preview: 'fix the bug' },
          { id: 'b', agentLabel: 'Codex', timestamp: NOW - DAY, preview: 'old chat' },
        ]}
      />,
    )
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('Yesterday')).toBeTruthy()
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText('5m ago')).toBeTruthy()
    expect(screen.getByText('fix the bug')).toBeTruthy()
  })

  it('opens the agent pane for a clicked conversation', () => {
    const onOpen = vi.fn()
    render(
      <Timeline
        now={NOW}
        onOpen={onOpen}
        conversations={[{ id: 'conv-7', agentLabel: 'Claude Code', timestamp: NOW }]}
      />,
    )
    fireEvent.click(screen.getByText('Claude Code'))
    expect(onOpen).toHaveBeenCalledWith('conv-7')
  })

  it('renders an empty state when there are no conversations', () => {
    render(<Timeline now={NOW} onOpen={() => {}} conversations={[]} />)
    expect(screen.getByText(/no conversations yet/i)).toBeTruthy()
  })
})
