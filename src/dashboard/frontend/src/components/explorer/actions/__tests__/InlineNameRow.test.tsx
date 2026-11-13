import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { InlineNameRow, type InlineNameRowProps } from '../InlineNameRow'

function renderRow(over: Partial<InlineNameRowProps> = {}) {
  const props: InlineNameRowProps = {
    depth: 1,
    kind: 'file',
    initialValue: '',
    siblings: ['taken.ts'],
    onCommit: vi.fn(async () => null),
    onCancel: vi.fn(),
    ...over,
  }
  const parentKeyDown = vi.fn()
  render(
    <div onKeyDown={parentKeyDown}>
      <InlineNameRow {...props} />
    </div>,
  )
  const input = screen.getByRole('textbox')
  return { props, input, parentKeyDown }
}

describe('InlineNameRow', () => {
  it('focuses on mount and selects the stem of a renamed file', () => {
    const { input } = renderRow({ initialValue: 'name.test.ts', current: 'name.test.ts' })
    expect(input).toHaveFocus()
    expect((input as HTMLInputElement).selectionStart).toBe(0)
    expect((input as HTMLInputElement).selectionEnd).toBe('name.test'.length)
  })

  it('selects the whole name of a folder', () => {
    const folder = renderRow({ kind: 'dir', initialValue: 'src.old', current: 'src.old' }).input as HTMLInputElement
    expect([folder.selectionStart, folder.selectionEnd]).toEqual([0, 7])
  })

  it('selects the whole name of a dotfile', () => {
    const dotfile = renderRow({ initialValue: '.env', current: '.env' }).input as HTMLInputElement
    expect([dotfile.selectionStart, dotfile.selectionEnd]).toEqual([0, 4])
  })

  it('commits the trimmed name on Enter', async () => {
    const { props, input } = renderRow()
    fireEvent.change(input, { target: { value: '  x.ts ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith('x.ts'))
  })

  it('cancels on Escape', () => {
    const escaped = renderRow()
    fireEvent.keyDown(escaped.input, { key: 'Escape' })
    expect(escaped.props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on a blur when the rename value did not change', () => {
    const { props, input } = renderRow({ initialValue: 'a.ts', current: 'a.ts' })
    fireEvent.blur(input)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('commits a changed valid name on blur', async () => {
    const { props, input } = renderRow()
    fireEvent.change(input, { target: { value: 'y.ts' } })
    fireEvent.blur(input)
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith('y.ts'))
  })

  it('Escape then blur cancels once and never commits', () => {
    const { props, input } = renderRow()
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('Enter then blur commits exactly once', async () => {
    const { props, input } = renderRow()
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledTimes(1))
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('shows the D-E11 message for an invalid name and does not commit', () => {
    const { props, input } = renderRow()
    fireEvent.change(input, { target: { value: 'taken.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('taken.ts already exists here.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('shows "Enter a name." on Enter with an empty value', () => {
    const { props, input } = renderRow()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('disables the input while the commit is pending', async () => {
    let resolve: (value: string | null) => void = () => {}
    const onCommit = vi.fn(() => new Promise<string | null>((r) => (resolve = r)))
    const { input } = renderRow({ onCommit })
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toBeDisabled()
    await act(async () => resolve(null))
  })

  it('keeps the row open with a server error message and allows a retry', async () => {
    const onCommit = vi.fn(async () => 'x.ts already exists here.')
    const { props, input } = renderRow({ onCommit })
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('x.ts already exists here.')
    expect(input).not.toBeDisabled()
    expect(props.onCancel).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'z.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2))
  })

  it('stops every key at the input, and ignores Enter while composing', () => {
    const { props, input, parentKeyDown } = renderRow()
    fireEvent.change(input, { target: { value: 'x.ts' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(parentKeyDown).not.toHaveBeenCalled()
    expect(props.onCommit).not.toHaveBeenCalled()
  })
})
