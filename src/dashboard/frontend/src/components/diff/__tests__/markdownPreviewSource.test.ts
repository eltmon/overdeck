import { describe, expect, it } from 'vitest'
import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'

import {
  NO_ROOT_PREVIEW,
  OUTSIDE_ROOT_PREVIEW,
  addedFileText,
  diffPathToRootPath,
  isDeletedDiffFile,
  markdownPreviewSource,
} from '../markdownPreviewSource'

const NEW_FILE_PATCH = [
  'diff --git a/docs/a.md b/docs/a.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/docs/a.md',
  '@@ -0,0 +1,3 @@',
  '+# Title',
  '+',
  '+body',
  '',
].join('\n')

function parseFirstFile(patch: string): FileDiffMetadata {
  const files = parsePatchFiles(patch, 'markdown-preview-source-test').flatMap((p) => p.files)
  const file = files[0]
  if (!file) throw new Error('expected a parsed file')
  return file
}

const MODIFIED_FILE: FileDiffMetadata = {
  name: 'b/docs/a.md',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
}

describe('addedFileText', () => {
  it('returns the new file text for a new-file patch, with a trailing newline on every line', () => {
    const file = parseFirstFile(NEW_FILE_PATCH)
    expect(addedFileText(file)).toBe('# Title\n\nbody\n')
  })

  it('returns null for a non-new file', () => {
    expect(addedFileText(MODIFIED_FILE)).toBeNull()
  })
})

describe('isDeletedDiffFile', () => {
  it('is true for a file of type deleted', () => {
    expect(isDeletedDiffFile({ ...MODIFIED_FILE, type: 'deleted' }, undefined)).toBe(true)
  })

  it('is true for a list kind starting with D', () => {
    expect(isDeletedDiffFile(undefined, 'D')).toBe(true)
    expect(isDeletedDiffFile(undefined, 'd100')).toBe(true)
  })

  it('is false for a modified file with a non-delete list kind', () => {
    expect(isDeletedDiffFile(MODIFIED_FILE, 'M')).toBe(false)
  })
})

describe('markdownPreviewSource', () => {
  it('returns the patch text for an added file regardless of scope', () => {
    const file = parseFirstFile(NEW_FILE_PATCH)
    const result = markdownPreviewSource({
      file,
      scope: { kind: 'vs-main' },
      agentRoute: false,
      rootId: null,
      rootPath: null,
    })
    expect(result).toEqual({ kind: 'patch', text: '# Title\n\nbody\n' })
  })

  it('returns unavailable with NO_ROOT_PREVIEW when rootId is null', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'full' },
      agentRoute: false,
      rootId: null,
      rootPath: null,
    })
    expect(result).toEqual({ kind: 'unavailable', message: NO_ROOT_PREVIEW })
  })

  it('returns unavailable with OUTSIDE_ROOT_PREVIEW when rootPath is null but rootId is known', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'full' },
      agentRoute: false,
      rootId: 'issue:PAN-1',
      rootPath: null,
    })
    expect(result).toEqual({ kind: 'unavailable', message: OUTSIDE_ROOT_PREVIEW })
  })

  it('reads without a ref and without a note for a modified file in full scope', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'full' },
      agentRoute: false,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })
  })

  it('reads HEAD for vs-main', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'vs-main' },
      agentRoute: false,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({
      kind: 'read',
      rootId: 'issue:PAN-1',
      path: 'docs/a.md',
      ref: 'HEAD',
      note: false,
    })
  })

  it('notes the current file for compare', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'compare' },
      agentRoute: false,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: true })
  })

  it('notes the current file for an agent-route turn that is not the newest', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'turn', newest: false },
      agentRoute: true,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: true })
  })

  it('does not note the newest agent-route turn', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'turn', newest: true },
      agentRoute: true,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })
  })

  it('does not note a conversation-route (non agent-route) older turn', () => {
    const result = markdownPreviewSource({
      file: MODIFIED_FILE,
      scope: { kind: 'turn', newest: false },
      agentRoute: false,
      rootId: 'issue:PAN-1',
      rootPath: 'docs/a.md',
    })
    expect(result).toEqual({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })
  })
})

describe('diffPathToRootPath', () => {
  it('returns the repo path unchanged when repoRoot is null', () => {
    expect(
      diffPathToRootPath('docs/a.md', { repoRoot: null, rootAbs: '/ws/feature-pan-1', cwd: null }),
    ).toBe('docs/a.md')
  })

  it('returns the repo path unchanged when rootAbs is null', () => {
    expect(
      diffPathToRootPath('docs/a.md', { repoRoot: '/ws/feature-pan-1', rootAbs: null, cwd: null }),
    ).toBe('docs/a.md')
  })

  it('strips the root prefix when the root sits inside the repo', () => {
    expect(
      diffPathToRootPath('packages/app/docs/a.md', {
        repoRoot: '/ws/feature-pan-1',
        rootAbs: '/ws/feature-pan-1/packages/app',
        cwd: null,
      }),
    ).toBe('docs/a.md')
  })

  it('returns null when cwd is outside rootAbs', () => {
    expect(
      diffPathToRootPath('docs/a.md', {
        repoRoot: '/ws/feature-pan-1',
        rootAbs: '/ws/feature-pan-1',
        cwd: '/other/dir',
      }),
    ).toBeNull()
  })

  it('does not treat a sibling path with the same prefix as inside the root', () => {
    expect(
      diffPathToRootPath('docs/a.md', {
        repoRoot: '/ws/feature-pan-1',
        rootAbs: '/ws/feature-pan-1',
        cwd: '/ws/feature-pan-10',
      }),
    ).toBeNull()
  })
})
