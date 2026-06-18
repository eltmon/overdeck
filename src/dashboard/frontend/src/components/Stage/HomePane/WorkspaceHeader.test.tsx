import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceHeader } from './WorkspaceHeader'

describe('WorkspaceHeader', () => {
  it('shows the workspace name and branch', () => {
    render(<WorkspaceHeader name="overdeck" branch="feature/pan-1549" iconLabel="P" />)
    expect(screen.getByRole('heading', { name: 'overdeck' })).toBeTruthy()
    expect(screen.getByText(/feature\/pan-1549/)).toBeTruthy()
    expect(screen.getByText('P')).toBeTruthy()
  })

  it('renders without crashing when branch is absent (non-agent workspace)', () => {
    render(<WorkspaceHeader name="Some Project" />)
    expect(screen.getByRole('heading', { name: 'Some Project' })).toBeTruthy()
    expect(screen.queryByText(/feature\//)).toBeNull()
  })

  it('renders the set-parent link only when onSetParent is provided', () => {
    const onSetParent = vi.fn()
    const { rerender } = render(<WorkspaceHeader name="x" />)
    expect(screen.queryByText(/set parent/i)).toBeNull()

    rerender(<WorkspaceHeader name="x" onSetParent={onSetParent} />)
    const link = screen.getByText(/set parent/i)
    fireEvent.click(link)
    expect(onSetParent).toHaveBeenCalledOnce()
  })
})
