import { describe, expect, it } from 'vitest'
import { parseDiffFromFile } from '@pierre/diffs'

import { NO_ROOT_PREVIEW, OUTSIDE_ROOT_PREVIEW } from '../../diff/markdownPreviewSource'
import { dockMarkdownPreview, dockPreviewScope } from '../changes/dockDiffPreview'
import type { DockDiffTarget } from '../workDockStore'

const MODIFIED_MD = `diff --git a/docs/a.md b/docs/a.md\nindex 1111111..2222222 100644\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-# Old\n+# New\n`
const ADDED_MD = `diff --git a/docs/a.md b/docs/a.md\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/docs/a.md\n@@ -0,0 +1,3 @@\n+# Title\n+\n+body\n`
const DELETED_MD = `diff --git a/docs/a.md b/docs/a.md\ndeleted file mode 100644\nindex 2222222..0000000\n--- a/docs/a.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-# Gone\n`

function target(overrides: Partial<DockDiffTarget> = {}): DockDiffTarget {
  return { path: 'docs/a.md', ...overrides }
}

describe('dockMarkdownPreview', () => {
  it('returns null for a non-Markdown path', () => {
    const result = dockMarkdownPreview({
      target: target({ path: 'src/foo.ts' }),
      body: { kind: 'files', files: [], deleted: false },
      rootId: 'issue:PAN-1',
    })
    expect(result).toBeNull()
  })

  it('returns null for a message body', () => {
    const result = dockMarkdownPreview({
      target: target(),
      body: { kind: 'message', text: 'Too large' },
      rootId: 'issue:PAN-1',
    })
    expect(result).toBeNull()
  })

  it('returns null for an uncommitted deleted file', () => {
    const result = dockMarkdownPreview({
      target: target(),
      body: { kind: 'files', files: [], deleted: true },
      rootId: 'issue:PAN-1',
    })
    expect(result).toBeNull()
  })

  it('reads the working tree for an uncommitted new file (D-2)', () => {
    const file = parseDiffFromFile({ name: 'docs/a.md', contents: '' }, { name: 'docs/a.md', contents: '# New\n' })
    const result = dockMarkdownPreview({
      target: target(),
      body: { kind: 'files', files: [file], deleted: false },
      rootId: 'issue:PAN-1',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })
  })

  it('reads HEAD for a committedVsMain modified file', () => {
    const result = dockMarkdownPreview({
      target: target({ committedVsMain: true }),
      body: { kind: 'patch', patch: MODIFIED_MD },
      rootId: 'issue:PAN-1',
    })
    expect(result).toEqual({
      kind: 'read',
      rootId: 'issue:PAN-1',
      path: 'docs/a.md',
      ref: 'HEAD',
      note: false,
    })
  })

  it('returns patch text for a committedVsMain added file', () => {
    const result = dockMarkdownPreview({
      target: target({ committedVsMain: true }),
      body: { kind: 'patch', patch: ADDED_MD },
      rootId: 'issue:PAN-1',
    })
    expect(result).toEqual({ kind: 'patch', text: '# Title\n\nbody\n' })
  })

  it('notes the current file for a commit modified file', () => {
    const result = dockMarkdownPreview({
      target: target({ sha: 'abc' }),
      body: { kind: 'patch', patch: MODIFIED_MD },
      rootId: 'project:p',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'project:p', path: 'docs/a.md', note: true })
  })

  it('returns patch text for a commit added file', () => {
    const result = dockMarkdownPreview({
      target: target({ sha: 'abc' }),
      body: { kind: 'patch', patch: ADDED_MD },
      rootId: 'project:p',
    })
    expect(result).toEqual({ kind: 'patch', text: '# Title\n\nbody\n' })
  })

  it('returns null for a commit deleted file', () => {
    const result = dockMarkdownPreview({
      target: target({ sha: 'abc' }),
      body: { kind: 'patch', patch: DELETED_MD },
      rootId: 'project:p',
    })
    expect(result).toBeNull()
  })

  it('notes the current file for a commit with an empty patch (D-4)', () => {
    const result = dockMarkdownPreview({
      target: target({ sha: 'abc' }),
      body: { kind: 'patch', patch: '' },
      rootId: 'project:p',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'project:p', path: 'docs/a.md', note: true })
  })

  it('returns unavailable with OUTSIDE_ROOT_PREVIEW when the target is outside the root', () => {
    const result = dockMarkdownPreview({
      target: target({ committedVsMain: true, outsideRoot: true }),
      body: { kind: 'patch', patch: MODIFIED_MD },
      rootId: 'issue:PAN-1',
    })
    expect(result).toEqual({ kind: 'unavailable', message: OUTSIDE_ROOT_PREVIEW })
  })

  it('returns unavailable with NO_ROOT_PREVIEW when rootId is null', () => {
    const result = dockMarkdownPreview({
      target: target({ committedVsMain: true }),
      body: { kind: 'patch', patch: MODIFIED_MD },
      rootId: null,
    })
    expect(result).toEqual({ kind: 'unavailable', message: NO_ROOT_PREVIEW })
  })

  it('maps target source to the matching PreviewScope', () => {
    expect(dockPreviewScope(target({ sha: 'abc' }))).toEqual({ kind: 'compare' })
    expect(dockPreviewScope(target({ committedVsMain: true }))).toEqual({ kind: 'vs-main' })
    expect(dockPreviewScope(target())).toEqual({ kind: 'full' })
  })
})
