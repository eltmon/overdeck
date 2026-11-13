import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodePaneHeader, isMarkdownPath, type CodePaneHeaderProps } from '../CodePaneHeader'

function renderHeader(over: Partial<CodePaneHeaderProps> = {}) {
  const props: CodePaneHeaderProps = {
    path: 'docs/README.md',
    view: 'edit',
    onView: vi.fn(),
    wordWrap: 'on',
    onToggleWrap: vi.fn(),
    preview: false,
    onKeepOpen: vi.fn(),
    ...over,
  }
  render(<CodePaneHeader {...props} />)
  return props
}

describe('isMarkdownPath', () => {
  it('matches .md, .mdx and .markdown in any case', () => {
    expect(['a.md', 'b.MDX', 'c.markdown'].every(isMarkdownPath)).toBe(true)
    expect(isMarkdownPath('a.ts')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('CodePaneHeader', () => {
  it('shows the path and Edit / Preview tabs for a markdown file', () => {
    const props = renderHeader()
    expect(screen.getByText('docs/README.md')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Edit' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(props.onView).toHaveBeenCalledWith('preview')
  })

  it('shows no Edit / Preview tabs for a non-markdown file', () => {
    renderHeader({ path: 'src/a.ts' })
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('reports word wrap with aria-pressed and toggles it', () => {
    const props = renderHeader({ wordWrap: 'on' })
    const wrap = screen.getByRole('button', { name: 'Wrap' })
    expect(wrap.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(wrap)
    expect(props.onToggleWrap).toHaveBeenCalledTimes(1)
  })

  it('shows Keep open only for a preview tab, and Changes only when wired', () => {
    renderHeader({ preview: false })
    expect(screen.queryByRole('button', { name: 'Keep open' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Changes' })).toBeNull()
  })

  it('wires Keep open and Changes', () => {
    const onToggleChanges = vi.fn()
    const props = renderHeader({ preview: true, changes: true, onToggleChanges })
    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }))
    expect(props.onKeepOpen).toHaveBeenCalledTimes(1)
    const changes = screen.getByRole('button', { name: 'Changes' })
    expect(changes.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(changes)
    expect(onToggleChanges).toHaveBeenCalledTimes(1)
  })
})
