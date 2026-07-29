import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { getDraftsDir, getIssueDraftPath } from '../drafts.js'

// A case-insensitive filesystem (macOS APFS) cannot hold both casings of one
// filename, so the both-casings fixture below is unbuildable there.
const caseSensitiveFs = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'pan-case-probe-'))
  try {
    writeFileSync(join(probe, 'a.md'), '')
    return !existsSync(join(probe, 'A.md'))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

// PAN-3287: the draft path resolver must never point a write at the missing
// case-twin of an existing draft — that tracks a case-colliding pair that
// case-insensitive checkouts (macOS) cannot materialize.
describe('getIssueDraftPath case resolution', () => {
  let tmp: string
  let draftsDir: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-drafts-case-'))
    draftsDir = getDraftsDir(tmp)
    mkdirSync(draftsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('resolves a new draft to the lowercase canonical filename', () => {
    expect(basename(getIssueDraftPath(tmp, 'PAN-123'))).toBe('pan-123.md')
  })

  it('resolves an existing legacy uppercase draft in place', () => {
    writeFileSync(join(draftsDir, 'PAN-123.md'), 'legacy')
    expect(basename(getIssueDraftPath(tmp, 'PAN-123'))).toBe('PAN-123.md')
  })

  it.runIf(caseSensitiveFs)('prefers the lowercase file when both casings exist', () => {
    writeFileSync(join(draftsDir, 'PAN-123.md'), 'legacy')
    writeFileSync(join(draftsDir, 'pan-123.md'), 'canonical')
    expect(basename(getIssueDraftPath(tmp, 'PAN-123'))).toBe('pan-123.md')
  })

  it('resolves an existing lowercase draft regardless of query casing', () => {
    writeFileSync(join(draftsDir, 'pan-123.md'), 'canonical')
    expect(basename(getIssueDraftPath(tmp, 'pan-123'))).toBe('pan-123.md')
    expect(basename(getIssueDraftPath(tmp, 'PAN-123'))).toBe('pan-123.md')
  })
})
