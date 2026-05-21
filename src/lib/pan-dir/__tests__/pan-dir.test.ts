import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  PAN_CONTEXT_FILENAME,
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
  PAN_SPEC_FILENAME,
  PAN_SPECS_DIRNAME,
  appendSession,
  asPanSpecDocument,
  clearFeedback,
  ensurePanDirs,
  ensureWorkspacePanDir,
  findSpecByIssue,
  getDraftPath,
  getProjectPanPaths,
  getWorkspacePanPaths,
  listSpecs,
  readFeedback,
  readSessions,
  readSpec,
  readWorkspaceContext,
  readWorkspaceContinue,
  updateSpecStatus,
  writeFeedback,
  writeSpec,
  writeWorkspaceContext,
  writeWorkspaceContinue,
  type WorkspaceContinueState,
} from '../index.js'
import type { VBriefDocument } from '../../vbrief/types.js'

let TEST_DIR: string

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'pan-dir-'))
})

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
})

function makeDoc(issueId: string, title: string, status = 'draft'): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.5',
      created: '2026-05-04T00:00:00Z',
      updated: '2026-05-04T00:00:00Z',
    },
    plan: {
      id: issueId,
      title,
      status,
      items: [],
      edges: [],
      created: '2026-05-04T00:00:00Z',
      updated: '2026-05-04T00:00:00Z',
    },
  }
}

function makeContinue(issueId: string): WorkspaceContinueState {
  return {
    version: '1',
    issueId,
    created: '2026-05-04T00:00:00.000Z',
    updated: '2026-05-04T00:00:00.000Z',
    gitState: { branch: `feature/${issueId.toLowerCase()}` },
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
    feedback: [],
  }
}

describe('ensurePanDirs / getProjectPanPaths', () => {
  it.effect('creates project .pan/specs and .pan/drafts directories', () =>
    Effect.gen(function* () {
      const paths = yield* ensurePanDirs(TEST_DIR)
      expect(paths.panDir).toBe(join(TEST_DIR, PAN_DIRNAME))
      expect(existsSync(paths.specsDir)).toBe(true)
      expect(existsSync(paths.draftsDir)).toBe(true)
    }),
  )

  it('returns stable project paths', () => {
    const paths = getProjectPanPaths(TEST_DIR)
    expect(paths.specsDir).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_SPECS_DIRNAME))
    expect(getDraftPath(TEST_DIR, 'PAN-1.md')).toBe(join(TEST_DIR, PAN_DIRNAME, 'drafts', 'PAN-1.md'))
  })
})

describe('ensureWorkspacePanDir / getWorkspacePanPaths', () => {
  it.effect('creates workspace .pan and feedback directory', () =>
    Effect.gen(function* () {
      const paths = yield* ensureWorkspacePanDir(TEST_DIR)
      expect(paths.specPath).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_SPEC_FILENAME))
      expect(paths.continuePath).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_CONTINUE_FILENAME))
      expect(paths.sessionsPath).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_SESSIONS_FILENAME))
      expect(paths.feedbackDir).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_FEEDBACK_DIRNAME))
      expect(paths.contextPath).toBe(join(TEST_DIR, PAN_DIRNAME, PAN_CONTEXT_FILENAME))
      expect(existsSync(paths.feedbackDir)).toBe(true)
    }),
  )

  it('returns stable workspace paths', () => {
    const paths = getWorkspacePanPaths(TEST_DIR)
    expect(paths.panDir).toBe(join(TEST_DIR, PAN_DIRNAME))
  })
})

describe('spec helpers', () => {
  it.effect('writes and reads a pan spec document', () =>
    Effect.gen(function* () {
      const paths = yield* ensurePanDirs(TEST_DIR)
      const path = join(paths.specsDir, '2026-05-04-PAN-967-unified-pan-directory.vbrief.json')
      yield* writeSpec(path, asPanSpecDocument(makeDoc('PAN-967', 'Unified .pan Directory'), 'proposed'))

      const read = yield* readSpec(path)
      expect(read.status).toBe('proposed')
      expect(read.plan.id).toBe('PAN-967')
    }),
  )

  it.effect('lists specs and filters by root status', () =>
    Effect.gen(function* () {
      const paths = yield* ensurePanDirs(TEST_DIR)
      yield* writeSpec(
        join(paths.specsDir, '2026-05-04-PAN-1-first.vbrief.json'),
        asPanSpecDocument(makeDoc('PAN-1', 'First Plan'), 'proposed'),
      )
      yield* writeSpec(
        join(paths.specsDir, '2026-05-04-PAN-2-second.vbrief.json'),
        asPanSpecDocument(makeDoc('PAN-2', 'Second Plan'), 'active'),
      )

      const all = yield* listSpecs(TEST_DIR)
      expect(all).toHaveLength(2)
      const active = yield* listSpecs(TEST_DIR, { status: 'active' })
      expect(active.map((spec) => spec.issueId)).toEqual(['PAN-2'])
    }),
  )

  it.effect('finds a spec by issue and updates root status in place', () =>
    Effect.gen(function* () {
      const paths = yield* ensurePanDirs(TEST_DIR)
      const path = join(paths.specsDir, '2026-05-04-PAN-967-unified-pan-directory.vbrief.json')
      yield* writeSpec(path, asPanSpecDocument(makeDoc('PAN-967', 'Unified .pan Directory'), 'proposed'))

      const found = yield* findSpecByIssue(TEST_DIR, 'pan-967')
      expect(found?.filename).toBe('2026-05-04-PAN-967-unified-pan-directory.vbrief.json')

      const updated = yield* updateSpecStatus(TEST_DIR, 'PAN-967', 'active')
      expect(updated?.status).toBe('active')
      const reread = yield* readSpec(path)
      expect(reread.status).toBe('active')
    }),
  )
})

describe('continue helpers', () => {
  it.effect('round-trips workspace continue state and preserves created timestamp', () =>
    Effect.gen(function* () {
      const first = yield* writeWorkspaceContinue(TEST_DIR, makeContinue('PAN-967'))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)))
      const second = yield* writeWorkspaceContinue(TEST_DIR, {
        ...first,
        decisions: [{ id: 'D1', summary: 'Use .pan', recordedAt: '2026-05-04T01:00:00Z' }],
      })

      const read = yield* readWorkspaceContinue(TEST_DIR)
      expect(read?.issueId).toBe('PAN-967')
      expect(read?.created).toBe(first.created)
      expect(new Date(second.updated).getTime()).toBeGreaterThan(new Date(first.updated).getTime())
    }),
  )

  it.effect('returns null when workspace continue file is missing', () =>
    Effect.gen(function* () {
      const result = yield* readWorkspaceContinue(TEST_DIR)
      expect(result).toBeNull()
    }),
  )
})

describe('sessions helpers', () => {
  it.effect('appends and reads JSONL session entries', () =>
    Effect.gen(function* () {
      yield* appendSession(TEST_DIR, {
        timestamp: '2026-05-04T00:00:00Z',
        reason: 'planning',
        note: 'started',
      })
      yield* appendSession(TEST_DIR, {
        timestamp: '2026-05-04T01:00:00Z',
        reason: 'resume',
      })

      const sessions = yield* readSessions(TEST_DIR)
      expect(sessions).toHaveLength(2)
      expect(sessions[0].reason).toBe('planning')
      expect(sessions[1].reason).toBe('resume')
    }),
  )
})

describe('feedback helpers', () => {
  it.effect('writes, reads, and clears feedback files', () =>
    Effect.gen(function* () {
      yield* writeFeedback(TEST_DIR, '001-review.md', 'Needs changes')
      yield* writeFeedback(TEST_DIR, '002-test.md', 'Add coverage')

      const initial = yield* readFeedback(TEST_DIR)
      expect(initial.map((file) => file.filename)).toEqual(['001-review.md', '002-test.md'])

      yield* clearFeedback(TEST_DIR)
      const cleared = yield* readFeedback(TEST_DIR)
      expect(cleared).toEqual([])
    }),
  )
})

describe('context helpers', () => {
  it.effect('writes and reads workspace context atomically', () =>
    Effect.gen(function* () {
      yield* writeWorkspaceContext(TEST_DIR, '# Context\n\nImportant details')
      const read = yield* readWorkspaceContext(TEST_DIR)
      expect(read).toBe('# Context\n\nImportant details')
    }),
  )

  it.effect('returns null when context file is missing', () =>
    Effect.gen(function* () {
      const result = yield* readWorkspaceContext(TEST_DIR)
      expect(result).toBeNull()
    }),
  )
})
