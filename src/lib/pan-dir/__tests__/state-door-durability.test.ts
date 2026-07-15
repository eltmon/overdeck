import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { execSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  asPanSpecDocument,
  buildPanSpecPath,
  ensurePanDirs,
  updateSpecStatus,
  writeIssueDraft,
  writeSpecDocument,
} from '../index.js'
import type { VBriefDocument } from '../../vbrief/types.js'

// PAN-2677: the state write door must commit+push every mutation immediately so
// the state worktree never lingers dirty. These tests exercise the door write
// APIs against a scratch git repo and assert `git status --porcelain` is empty
// afterwards. They also reproduce the husky/core.hooksPath failure mode that
// previously stranded state worktrees, and prove a genuine commit failure now
// surfaces loudly instead of being swallowed.

function configureGit(root: string): void {
  execSync('git config user.email t@e.t', { cwd: root })
  execSync('git config user.name "Test"', { cwd: root })
  execSync('git config commit.gpgsign false', { cwd: root })
}

function porcelain(root: string): string {
  return execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim()
}

function makeDoc(issueId: string, title: string, status = 'draft'): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.5',
      created: '2026-07-14T00:00:00Z',
      updated: '2026-07-14T00:00:00Z',
    },
    plan: {
      id: issueId,
      title,
      status,
      items: [],
      edges: [],
      created: '2026-07-14T00:00:00Z',
      updated: '2026-07-14T00:00:00Z',
    },
  } as VBriefDocument
}

/**
 * Install a git pre-commit hook via `core.hooksPath` (the shared-hooksPath
 * shape that couples a migrated state worktree to the code repo's `.husky/_`).
 * `huskyAware` mirrors husky's own wrapper, which short-circuits when
 * `HUSKY=0`; a non-husky-aware hook ignores the env and always fails.
 */
function installFailingPreCommitHook(root: string, huskyAware: boolean): void {
  // Live under .git/ so the hook scripts never appear in the worktree's own
  // `git status` (they are test scaffolding, not tracked content).
  const hooksDir = join(root, '.git', 'fake-hooks')
  mkdirSync(hooksDir, { recursive: true })
  const body = huskyAware
    ? '#!/bin/sh\n[ "$HUSKY" = "0" ] && exit 0\necho "missing hook script" >&2\nexit 127\n'
    : '#!/bin/sh\necho "hook always fails" >&2\nexit 1\n'
  const hookPath = join(hooksDir, 'pre-commit')
  writeFileSync(hookPath, body)
  chmodSync(hookPath, 0o755)
  execSync('git config core.hooksPath .git/fake-hooks', { cwd: root })
}

describe('state write door durability (PAN-2677)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-state-door-'))
    execSync('git init -q', { cwd: tmp })
    configureGit(tmp)
    writeFileSync(join(tmp, 'README.md'), 'seed')
    execSync('git add README.md', { cwd: tmp })
    execSync('git commit -q -m "init"', { cwd: tmp })
    execSync('git branch -M main', { cwd: tmp })
    // No origin: the door treats an origin-less scratch repo as commit-only
    // (pushed is undefined), so a clean local commit is enough to assert on.
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('leaves the worktree clean after writeIssueDraft', async () => {
    await Effect.runPromise(writeIssueDraft(tmp, 'PAN-1', '# PRD draft\n'))
    expect(porcelain(tmp)).toBe('')
  })

  it('leaves the worktree clean after writeSpecDocument', async () => {
    await Effect.runPromise(ensurePanDirs(tmp))
    const path = buildPanSpecPath(tmp, 'PAN-2', 'some title', '2026-07-14')
    await Effect.runPromise(
      writeSpecDocument(tmp, path, asPanSpecDocument(makeDoc('PAN-2', 'Some Title'), 'proposed')),
    )
    expect(porcelain(tmp)).toBe('')
  })

  it('leaves the worktree clean after updateSpecStatus', async () => {
    await Effect.runPromise(ensurePanDirs(tmp))
    const path = buildPanSpecPath(tmp, 'PAN-3', 'status change', '2026-07-14')
    await Effect.runPromise(
      writeSpecDocument(tmp, path, asPanSpecDocument(makeDoc('PAN-3', 'Status Change'), 'proposed')),
    )
    expect(porcelain(tmp)).toBe('')

    await Effect.runPromise(updateSpecStatus(tmp, 'PAN-3', 'active'))
    expect(porcelain(tmp)).toBe('')
  })

  it('commits through a husky-style core.hooksPath (HUSKY=0 reaches git)', async () => {
    // A migrated state worktree shares core.hooksPath with the code repo. The
    // husky wrapper exits 127 unless HUSKY=0; the door must pass HUSKY=0 so the
    // commit succeeds and the worktree stays clean rather than stranding dirty.
    installFailingPreCommitHook(tmp, /* huskyAware */ true)
    await Effect.runPromise(writeIssueDraft(tmp, 'PAN-4', '# hooked draft\n'))
    expect(porcelain(tmp)).toBe('')
  })

  it('surfaces a genuine commit failure loudly instead of leaving it swallowed', async () => {
    // A hook that ignores HUSKY simulates any real commit failure. The door
    // write must reject — not return quietly while the worktree stays dirty.
    installFailingPreCommitHook(tmp, /* huskyAware */ false)
    await expect(
      Effect.runPromise(writeIssueDraft(tmp, 'PAN-5', '# doomed draft\n')),
    ).rejects.toThrow()
  })
})
