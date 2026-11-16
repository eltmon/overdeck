import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DiffFileBar, DiffViewSwitch } from '../DiffFileBar'

describe('DiffFileBar', () => {
  it('renders no tablist when previewable is false', () => {
    render(<DiffFileBar path="src/a.ts" previewable={false} view="diff" onView={vi.fn()} />)

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('renders Diff selected and Preview when previewable is true', () => {
    render(<DiffFileBar path="docs/a.md" previewable view="diff" onView={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onView("preview") when the Preview tab is clicked', async () => {
    const onView = vi.fn()
    render(<DiffFileBar path="docs/a.md" previewable view="diff" onView={onView} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(onView).toHaveBeenCalledWith('preview')
  })

  it('renders no Open file button when onOpenFile is absent', () => {
    render(<DiffFileBar path="docs/a.md" previewable view="diff" onView={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Open file' })).not.toBeInTheDocument()
  })

  it('calls onOpenFile once when Open file is clicked', async () => {
    const onOpenFile = vi.fn()
    render(<DiffFileBar path="docs/a.md" previewable view="diff" onView={vi.fn()} onOpenFile={onOpenFile} />)

    await userEvent.click(screen.getByRole('button', { name: 'Open file' }))
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })
})

describe('DiffViewSwitch', () => {
  it('renders Diff and Preview tabs with aria-selected following view', () => {
    render(<DiffViewSwitch view="preview" onView={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('calls onView("diff") when the Diff tab is clicked while view is preview', async () => {
    const onView = vi.fn()
    render(<DiffViewSwitch view="preview" onView={onView} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Diff' }))
    expect(onView).toHaveBeenCalledWith('diff')
  })
})
