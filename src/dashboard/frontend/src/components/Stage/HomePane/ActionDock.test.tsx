import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionDock } from './ActionDock'

describe('ActionDock', () => {
  it('Terminal and Commits buttons open the matching pane types', () => {
    const onOpen = vi.fn()
    render(<ActionDock onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }))
    expect(onOpen).toHaveBeenCalledWith('terminal')
    fireEvent.click(screen.getByRole('button', { name: /Commits/ }))
    expect(onOpen).toHaveBeenCalledWith('commits')
  })

  it('does not expose Files or Web (deferred to #1550)', () => {
    render(<ActionDock onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: /Files/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Web/ })).toBeNull()
  })

  it('"+ Actions" overflow exposes Plan and Docs', () => {
    const onOpen = vi.fn()
    render(<ActionDock onOpen={onOpen} />)
    // Overflow hidden initially.
    expect(screen.queryByRole('menuitem', { name: /Plan/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Actions/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Plan/ }))
    expect(onOpen).toHaveBeenCalledWith('plan')

    fireEvent.click(screen.getByRole('menuitem', { name: /Docs/ }))
    expect(onOpen).toHaveBeenCalledWith('docs')
  })
})
