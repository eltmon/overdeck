import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('../../../hooks/useTheme', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
vi.mock('../../../hooks/useDiffPreferences', () => ({
  useDiffPreferences: () => ({
    prefs: {
      diffRenderMode: 'stacked',
      diffWordWrap: false,
      lineDiffType: 'word-alt',
      diffIndicators: 'bars',
      hunkSeparators: 'line-info',
      expandUnchanged: false,
      collapsedContextThreshold: 1,
      lineHoverHighlight: 'disabled',
      disableLineNumbers: false,
      enableLineSelection: false,
      ignoreWhitespace: false,
    },
    update: vi.fn(),
  }),
}))
// The shadow-DOM renderer is out of scope here; the list structure is what PatchFiles owns.
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div data-testid="virtualizer">{children}</div>,
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid="file-diff">{fileDiff.name}</div>,
}))

import { PatchFiles } from '../PatchFiles'

const TWO_FILES = `diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old b
+new b
diff --git a/src/a.ts b/src/a.ts
index 3333333..4444444 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old a
+new a
`

describe('PatchFiles', () => {
  it('renders one block per file, sorted by path, with data-diff-file-path', () => {
    const { container } = render(<PatchFiles patch={TWO_FILES} cacheScope="test" />)
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-diff-file-path]')]
    expect(blocks.map((b) => b.dataset.diffFilePath)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(screen.getAllByTestId('file-diff')).toHaveLength(2)
  })

  it('shows the raw text and its reason for a patch it cannot parse into files', () => {
    render(<PatchFiles patch="this is not a diff" cacheScope="test" />)
    expect(screen.getByText('this is not a diff')).toBeInTheDocument()
    expect(screen.getByText(/Showing raw patch\.$/)).toBeInTheDocument()
  })

  it('renders nothing for an empty patch', () => {
    const { container } = render(<PatchFiles patch="  " cacheScope="test" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('prefers parsed files over a patch', () => {
    const files = [{ name: 'only.ts', cacheKey: 'k1' }] as unknown as Parameters<typeof PatchFiles>[0]['files']
    const { container } = render(<PatchFiles patch={TWO_FILES} files={files} cacheScope="test" />)
    expect([...container.querySelectorAll<HTMLElement>('[data-diff-file-path]')].map((b) => b.dataset.diffFilePath)).toEqual(['only.ts'])
  })
})
