import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Launcher, intentLabel, DEFAULT_INTENTS } from './Launcher'

describe('intentLabel', () => {
  it('follows the terminal/web/agent label rules', () => {
    expect(intentLabel({ id: 't', kind: 'terminal' })).toBe('Run in terminal:')
    expect(intentLabel({ id: 'w', kind: 'web' })).toBe('Search the web:')
    expect(intentLabel({ id: 'c', kind: 'agent', agentName: 'Claude Code' })).toBe('Ask Claude Code:')
  })
})

describe('Launcher', () => {
  it('hides the dropdown when the input is empty and reveals it on typing', () => {
    render(<Launcher />)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(DEFAULT_INTENTS.length)
  })

  it('auto-selects the first row', () => {
    render(<Launcher />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking a row fires onSelect via onMouseDown without blurring the input', () => {
    const onSelect = vi.fn()
    render(<Launcher onSelect={onSelect} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'deploy' } })
    input.focus()

    const terminalRow = screen.getAllByRole('option')[1]
    // mousedown is where the action fires; default must be prevented to keep focus.
    const ev = fireEvent.mouseDown(terminalRow)
    expect(ev).toBe(false) // preventDefault was called
    expect(onSelect).toHaveBeenCalledWith(DEFAULT_INTENTS[1], 'deploy')
    expect(document.activeElement).toBe(input)
  })

  it('runs keyboard accelerators: ⌘↵ top, ⌃↵ terminal, ⌥↵ web, ⌘⇧↵ codex', () => {
    const onSelect = vi.fn()
    render(<Launcher onSelect={onSelect} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'go' } })

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(DEFAULT_INTENTS[0], 'go') // claude-code (top)

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onSelect.mock.lastCall?.[0].kind).toBe('terminal')

    fireEvent.keyDown(input, { key: 'Enter', altKey: true })
    expect(onSelect.mock.lastCall?.[0].kind).toBe('web')

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true, shiftKey: true })
    expect(onSelect.mock.lastCall?.[0].id).toBe('codex')
  })

  it('plain Enter runs the highlighted selection', () => {
    const onSelect = vi.fn()
    render(<Launcher onSelect={onSelect} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'go' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(DEFAULT_INTENTS[0], 'go')
  })

  it('hides extras in compact mode but shows them otherwise', () => {
    const extras = <div data-testid="history">recent</div>
    const { rerender } = render(<Launcher extras={extras} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    expect(screen.getByTestId('history')).toBeTruthy()

    rerender(<Launcher extras={extras} compact />)
    expect(screen.queryByTestId('history')).toBeNull()
    // Quick-action rows still render in compact mode.
    expect(screen.getAllByRole('option')).toHaveLength(DEFAULT_INTENTS.length)
  })
})
