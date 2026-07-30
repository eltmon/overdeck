import { afterEach, beforeEach, describe, expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'
import { execFileSync, execSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
import type { XBriefDocument } from '../../xbrief/types.js'

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

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim()
}

function porcelain(root: string): string {
  return execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim()
}

function makeDoc(issueId: string, title: string, status = 'draft'): XBriefDocument {
  return {
    xBRIEFInfo: {
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
  } as XBriefDocument
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

  it('commits and pushes the CLI start status flip while preserving workspace-draft fallback', async () => {
    const originalHome = process.env.OVERDECK_HOME
    const home = join(tmp, 'overdeck-home')
    const projectRoot = join(tmp, 'project')
    const stateRoot = join(home, 'state', 'durability')
    const remote = join(tmp, 'origin.git')
    const specPath = join(stateRoot, 'specs', '2026-07-30-PAN-3296-start-status.xbrief.json')

    try {
      process.env.OVERDECK_HOME = home
      mkdirSync(projectRoot, { recursive: true })
      mkdirSync(join(home, 'state'), { recursive: true })
      mkdirSync(join(stateRoot, 'specs'), { recursive: true })
      writeFileSync(join(home, 'projects.yaml'), JSON.stringify({
        projects: {
          durability: {
            name: 'Durability',
            path: projectRoot,
            issue_prefix: 'PAN',
          },
        },
      }))

      git(projectRoot, 'init', '-q', '-b', 'main')
      configureGit(projectRoot)
      writeFileSync(join(projectRoot, 'README.md'), 'project\n')
      git(projectRoot, 'add', 'README.md')
      git(projectRoot, 'commit', '-q', '-m', 'seed project')

      git(tmp, 'init', '--bare', '-q', remote)
      git(stateRoot, 'init', '-q')
      configureGit(stateRoot)
      git(stateRoot, 'branch', '-M', 'overdeck-state')
      git(stateRoot, 'remote', 'add', 'origin', remote)
      writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
        sourceMainSha: '0'.repeat(40),
        stateBranchSha: '0'.repeat(40),
        completedAt: '2026-07-30T00:00:00.000Z',
        version: 1,
      }))
      writeFileSync(specPath, JSON.stringify(
        asPanSpecDocument(makeDoc('PAN-3296', 'CLI start status', 'proposed'), 'proposed'),
        null,
        2,
      ))
      git(stateRoot, 'add', '.')
      git(stateRoot, 'commit', '-q', '-m', 'seed state')
      git(stateRoot, 'push', '-q', '-u', 'origin', 'overdeck-state')

      vi.resetModules()
      const { transitionStartedXBrief, updateWorkspaceDraftPlanStatus } =
        await import('../../../cli/commands/start-status.js')
      await transitionStartedXBrief(projectRoot, 'PAN-3296')

      const started = JSON.parse(readFileSync(specPath, 'utf-8')) as XBriefDocument
      expect(started.plan.status).toBe('running')
      expect(porcelain(stateRoot)).toBe('')
      expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(git(stateRoot, 'rev-parse', 'origin/overdeck-state'))
      expect(git(stateRoot, 'log', '-1', '--format=%s', 'origin/overdeck-state'))
        .toBe('chore(state): start PAN-3296 xBRIEF (status=running)')

      const stateHead = git(stateRoot, 'rev-parse', 'HEAD')
      const canonicalWorkspace = join(projectRoot, 'workspaces', 'feature-pan-3296')
      mkdirSync(canonicalWorkspace, { recursive: true })
      expect(updateWorkspaceDraftPlanStatus(canonicalWorkspace)).toBe(false)
      expect(porcelain(stateRoot)).toBe('')
      expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(stateHead)

      const workspace = join(projectRoot, 'workspaces', 'feature-pan-3297')
      const draftPath = join(workspace, '.overdeck', 'spec.vbrief.json')
      mkdirSync(join(workspace, '.overdeck'), { recursive: true })
      writeFileSync(draftPath, JSON.stringify(makeDoc('PAN-3297', 'Workspace draft', 'proposed'), null, 2))
      expect(updateWorkspaceDraftPlanStatus(workspace)).toBe(true)
      const workspaceDraft = JSON.parse(readFileSync(draftPath, 'utf-8')) as XBriefDocument
      expect(workspaceDraft.plan.status).toBe('running')
      expect(porcelain(stateRoot)).toBe('')
      expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(stateHead)
    } finally {
      if (originalHome === undefined) delete process.env.OVERDECK_HOME
      else process.env.OVERDECK_HOME = originalHome
      vi.resetModules()
    }
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
