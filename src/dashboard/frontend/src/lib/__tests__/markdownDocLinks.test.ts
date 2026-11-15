import { describe, expect, it } from 'vitest'

import { classifyDocHref, docDirOf, isDocumentRelativeHref, resolveDocPath } from '../markdownDocLinks'

describe('classifyDocHref', () => {
  it('classifies fort3d.md as relative', () => {
    expect(classifyDocHref('fort3d.md')).toEqual({ kind: 'relative', path: 'fort3d.md', trailingSlash: false })
  })

  it('classifies fort3d.md:12 as relative with line 12', () => {
    expect(classifyDocHref('fort3d.md:12')).toEqual({
      kind: 'relative',
      path: 'fort3d.md',
      line: 12,
      trailingSlash: false,
    })
  })

  it('classifies https and mailto as absolute', () => {
    expect(classifyDocHref('https://example.com')).toEqual({ kind: 'absolute' })
    expect(classifyDocHref('mailto:a@b')).toEqual({ kind: 'absolute' })
  })

  it('classifies /conv/123 as absolute', () => {
    expect(classifyDocHref('/conv/123')).toEqual({ kind: 'absolute' })
  })

  it('classifies #h as fragment', () => {
    expect(classifyDocHref('#h')).toEqual({ kind: 'fragment', slug: 'h' })
    expect(classifyDocHref('#Install')).toEqual({ kind: 'fragment', slug: 'Install' })
  })

  it('splits x.md#h into path x.md with no line', () => {
    expect(classifyDocHref('x.md#h')).toEqual({ kind: 'relative', path: 'x.md', trailingSlash: false })
  })

  it('reads x.md:12:3 and x.md#L12C3 as line 12 column 3', () => {
    expect(classifyDocHref('x.md:12:3')).toEqual({
      kind: 'relative',
      path: 'x.md',
      line: 12,
      column: 3,
      trailingSlash: false,
    })
    expect(classifyDocHref('x.md#L12C3')).toEqual({
      kind: 'relative',
      path: 'x.md',
      line: 12,
      column: 3,
      trailingSlash: false,
    })
  })

  it('keeps the trailing slash flag on levels/', () => {
    const classified = classifyDocHref('levels/')
    expect(classified.kind).toBe('relative')
    expect(classified).toMatchObject({ trailingSlash: true })
  })

  it('decodes %20 in a path', () => {
    expect(classifyDocHref('my%20doc.md')).toEqual({ kind: 'relative', path: 'my doc.md', trailingSlash: false })
  })

  it('isDocumentRelativeHref is true only for relative hrefs', () => {
    expect(isDocumentRelativeHref('fort3d.md')).toBe(true)
    expect(isDocumentRelativeHref('/conv/123')).toBe(false)
    expect(isDocumentRelativeHref('#h')).toBe(false)
    expect(isDocumentRelativeHref(undefined)).toBe(false)
  })
})

describe('resolveDocPath', () => {
  it('resolves a sibling', () => {
    expect(resolveDocPath('docs', 'fort3d.md')).toEqual({ kind: 'inside', path: 'docs/fort3d.md' })
  })

  it('resolves ../x.md upward', () => {
    expect(resolveDocPath('docs/x', '../x.md')).toEqual({ kind: 'inside', path: 'docs/x.md' })
    expect(resolveDocPath('docs/x', '../a.md')).toEqual({ kind: 'inside', path: 'docs/a.md' })
  })

  it('returns outside for a path that leaves the root', () => {
    expect(resolveDocPath('docs', '../../a.md')).toEqual({ kind: 'outside' })
  })

  it('returns outside for ~/x.md', () => {
    expect(resolveDocPath('docs', '~/x.md')).toEqual({ kind: 'outside' })
  })

  it('keeps a non-leading ~ segment as a literal path segment', () => {
    expect(resolveDocPath('docs', 'a/~/x.md')).toEqual({ kind: 'inside', path: 'docs/a/~/x.md' })
  })

  it('resolves the spec examples for levels/ and ../', () => {
    expect(resolveDocPath('docs', 'levels/')).toEqual({ kind: 'inside', path: 'docs/levels' })
    expect(resolveDocPath('docs', '../')).toEqual({ kind: 'inside', path: '' })
  })
})

describe('docDirOf', () => {
  it('docDirOf of a root file is empty', () => {
    expect(docDirOf('README.md')).toBe('')
  })

  it('docDirOf of a nested file is its folder', () => {
    expect(docDirOf('docs/index.md')).toBe('docs')
  })
})
