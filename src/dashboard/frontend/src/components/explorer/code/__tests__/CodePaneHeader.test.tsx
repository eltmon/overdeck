import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodePaneHeader, isMarkdownPath, type CodePaneHeaderProps } from '../CodePaneHeader'

function renderHeader(over: Partial<CodePaneHeaderProps> = {}) {
  const props: CodePaneHeaderProps = {
    path: 'docs/README.md',
    rootLabel: 'overdeck',
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
  it('shows the root label and path segments as a breadcrumb, the last one in the foreground color', () => {
    renderHeader({ rootLabel: 'overdeck', path: 'docs/a.md' })
    const crumb = screen.getByTestId('code-pane-breadcrumb')
    expect(crumb.textContent).toBe('overdeck›docs›a.md')
    expect(crumb.getAttribute('title')).toBe('docs/a.md')
    expect(screen.getByText('a.md').className).toContain('text-foreground')
    expect(screen.getByText('docs').className).not.toContain('text-foreground')
  })

  it('keeps the file name whole and lets the leading segments truncate (PAN-5370)', () => {
    renderHeader({ rootLabel: 'overdeck', path: 'src/dashboard/frontend/src/components/frame/LeftColumn.tsx' })
    const file = screen.getByTestId('code-pane-breadcrumb-file')
    expect(file.textContent).toBe('LeftColumn.tsx')
    expect(file.className).toContain('shrink-0')
    expect(file.className).toContain('truncate')
    expect(file.className).toContain('text-foreground')

    const lead = screen.getByTestId('code-pane-breadcrumb-lead')
    expect(lead.className).toContain('min-w-0')
    expect(lead.className).toContain('truncate')
    expect(lead.textContent).toBe('overdeck›src›dashboard›frontend›src›components›frame')
    expect(lead.textContent).not.toContain('LeftColumn.tsx')

    const sep = screen.getByTestId('code-pane-breadcrumb-sep')
    expect(sep.textContent).toBe('›')
    expect(sep.className).toContain('shrink-0')
    expect(within(lead).queryByTestId('code-pane-breadcrumb-sep')).not.toBeInTheDocument()

    expect(screen.getByTestId('code-pane-breadcrumb').getAttribute('title')).toBe('src/dashboard/frontend/src/components/frame/LeftColumn.tsx')
  })

  it('keeps a single-segment file name whole (PAN-5370)', () => {
    renderHeader({ rootLabel: 'overdeck', path: 'a.md' })
    expect(screen.getByTestId('code-pane-breadcrumb-lead').textContent).toBe('overdeck')
    expect(screen.getByTestId('code-pane-breadcrumb-sep').textContent).toBe('›')
    expect(screen.getByTestId('code-pane-breadcrumb-file').textContent).toBe('a.md')
  })

  it('shows Edit / Preview tabs for a markdown file', () => {
    const props = renderHeader()
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

  it('shows Keep open only for a preview tab, the mode tabs only when wired and Reveal only when wired', () => {
    renderHeader({ preview: false })
    expect(screen.queryByRole('button', { name: 'Keep open' })).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Mode' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reveal in files' })).toBeNull()
  })

  it('wires Keep open', () => {
    const props = renderHeader({ preview: true })
    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }))
    expect(props.onKeepOpen).toHaveBeenCalledTimes(1)
  })

  it('switches between File and Changes with the Mode tabs; the selected tab does nothing', () => {
    const onToggleChanges = vi.fn()
    const { rerender } = render(<CodePaneHeader path="src/a.ts" rootLabel="overdeck" view="edit" onView={vi.fn()} wordWrap="on" onToggleWrap={vi.fn()} preview={false} onKeepOpen={vi.fn()} changes={false} onToggleChanges={onToggleChanges} />)
    const mode = screen.getByRole('tablist', { name: 'Mode' })
    const file = within(mode).getByRole('tab', { name: 'File' })
    const changes = within(mode).getByRole('tab', { name: 'Changes' })
    expect(file.getAttribute('aria-selected')).toBe('true')
    expect(changes.getAttribute('title')).toBe('Show changes against HEAD')
    fireEvent.click(file)
    expect(onToggleChanges).not.toHaveBeenCalled()
    fireEvent.click(changes)
    expect(onToggleChanges).toHaveBeenCalledTimes(1)

    rerender(<CodePaneHeader path="src/a.ts" rootLabel="overdeck" view="edit" onView={vi.fn()} wordWrap="on" onToggleWrap={vi.fn()} preview={false} onKeepOpen={vi.fn()} changes onToggleChanges={onToggleChanges} />)
    expect(screen.getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'File' }))
    expect(onToggleChanges).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Changes' })).toBeNull()
  })

  it('calls onReveal from Reveal in files', () => {
    const onReveal = vi.fn()
    renderHeader({ onReveal })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in files' }))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })
})
