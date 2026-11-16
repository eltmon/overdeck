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

import { PatchFiles, sectionLabel } from '../PatchFiles'

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

const ZERO_SHA = '0'.repeat(40)

/** PAN-5418: one file changed in a commit section and again in the uncommitted section. */
const SECTIONED = `From ${'a'.repeat(40)} Mon Sep 17 00:00:00 2001
Subject: first

diff --git a/src/x.ts b/src/x.ts
index 1111111..2222222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-old x
+mid x
From ${ZERO_SHA} Mon Sep 17 00:00:00 2001
Subject: Uncommitted changes

diff --git a/src/x.ts b/src/x.ts
index 2222222..3333333 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-mid x
+new x
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

  it('labels commit-section files with short sha and subject', () => {
    render(<PatchFiles patch={SECTIONED} cacheScope="test" />)
    expect(screen.getAllByTestId('file-diff')).toHaveLength(2)
    expect(screen.getAllByTestId('diff-section-label').map((el) => el.textContent)).toEqual(['aaaaaaa first', 'Uncommitted'])
  })

  it('renders no label for a plain patch', () => {
    render(<PatchFiles patch={TWO_FILES} cacheScope="test" />)
    expect(screen.queryAllByTestId('diff-section-label')).toHaveLength(0)
  })
})

describe('sectionLabel', () => {
  it('returns undefined without a preamble', () => {
    expect(sectionLabel(undefined)).toBeUndefined()
  })

  it('returns Uncommitted for the zero sha', () => {
    expect(sectionLabel(`From ${ZERO_SHA} Mon Sep 17 00:00:00 2001\nSubject: Uncommitted changes\n`)).toBe('Uncommitted')
  })

  it('returns the short sha and subject for a commit preamble', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    expect(sectionLabel(`From ${sha} Mon Sep 17 00:00:00 2001\nSubject: fix the thing\n`)).toBe('0123456 fix the thing')
  })
})
