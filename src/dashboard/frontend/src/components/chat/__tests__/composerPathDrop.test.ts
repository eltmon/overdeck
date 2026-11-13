import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from 'lexical'

import { insertPathsIntoComposer } from '../composerPathDrop'

function editorWith(text: string, caret: number | null): LexicalEditor {
  const editor = createEditor({ onError: (error) => { throw error } })
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      const node = $createTextNode(text)
      paragraph.append(node)
      $getRoot().clear().append(paragraph)
      if (caret !== null) node.select(caret, caret)
    },
    { discrete: true },
  )
  return editor
}

async function textOf(editor: LexicalEditor): Promise<string> {
  // A plain editor.update commits in a microtask.
  await Promise.resolve()
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

describe('insertPathsIntoComposer', () => {
  it('inserts at the caret', async () => {
    const editor = editorWith('hello', 2)
    insertPathsIntoComposer(editor, ['src/a.ts'])
    expect(await textOf(editor)).toBe('hesrc/a.tsllo')
  })

  it('inserts two paths at the caret on separate lines', async () => {
    const editor = editorWith('hello', 2)
    insertPathsIntoComposer(editor, ['a.ts', 'b/c.ts'])
    expect(await textOf(editor)).toBe('hea.ts\nb/c.tsllo')
  })

  it('appends when there is no selection', async () => {
    const editor = editorWith('hello', null)
    insertPathsIntoComposer(editor, ['src/a.ts'])
    expect(await textOf(editor)).toBe('hellosrc/a.ts')
  })

  it('separates two paths with a line break', async () => {
    const editor = editorWith('', 0)
    insertPathsIntoComposer(editor, ['src/a.ts', 'lib'])
    expect(await textOf(editor)).toBe('src/a.ts\nlib')
  })

  it('does nothing for no paths', async () => {
    const editor = editorWith('hello', 2)
    insertPathsIntoComposer(editor, [])
    expect(await textOf(editor)).toBe('hello')
  })
})
