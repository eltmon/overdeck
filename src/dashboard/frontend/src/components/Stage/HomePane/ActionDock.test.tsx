import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionDock } from './ActionDock'

describe('ActionDock', () => {
  it('Terminal/Files/Web/Commits buttons open the matching pane types', () => {
    const onOpen = vi.fn()
    render(<ActionDock onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }))
    expect(onOpen).toHaveBeenCalledWith('terminal')
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    expect(onOpen).toHaveBeenCalledWith('files')
    fireEvent.click(screen.getByRole('button', { name: /Web/ }))
    expect(onOpen).toHaveBeenCalledWith('browser')
    fireEvent.click(screen.getByRole('button', { name: /Commits/ }))
    expect(onOpen).toHaveBeenCalledWith('commits')
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

  it('shows Main checkout only when given a handler, and calls it', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<ActionDock onOpen={onOpen} actions={['terminal', 'browser']} />)
    expect(screen.queryByTestId('action-dock-main-checkout')).toBeNull()

    const onOpenMainCheckout = vi.fn()
    rerender(<ActionDock onOpen={onOpen} actions={['terminal', 'browser']} onOpenMainCheckout={onOpenMainCheckout} />)
    fireEvent.click(screen.getByTestId('action-dock-main-checkout'))
    expect(onOpenMainCheckout).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
