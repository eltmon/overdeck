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
})
