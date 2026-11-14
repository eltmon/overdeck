// Seed the shared workflow UAT fixture (PAN-5287 §6.9, WI-S15).
//
//   node --import tsx scripts/dev/seed-workflow-fixture.ts --root <dir> [--home <dir>]
//
// Creates, under <root>: a bare `origin.git` and a `workflow-fixture` repo with
// two pushed commits, one local commit carrying an `Overdeck-Conversation:`
// trailer, uncommitted edits to docs/shared.md (lines 21-24 by fixture-1,
// lines 25-26 by fixture-2) and a git-ignored build/output.txt. Registers the
// repo as project `workflow-fixture` (issue prefix WFX), records conversations
// `fixture-1` and `fixture-2`, and writes their Claude Code transcripts under
// <home>/.claude/projects/<encoded repo path>/.
//
// It refuses to run against the operator's real Overdeck home (S-D11):
// OVERDECK_HOME must be set and must not be <os.homedir()>/.overdeck.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { registerProject } from '../../src/lib/projects.js'
import { createConversation, markConversationEnded } from '../../src/lib/overdeck/conversations.js'
import { claudeProjectDir, claudeProjectsRoot } from '../../src/lib/runtimes/storage/claude-code.js'

const execFileAsync = promisify(execFile)

export interface SeedOptions {
  root: string
  home: string
  now?: Date
}

export interface SeedResult {
  repoPath: string
  originPath: string
  projectKey: 'workflow-fixture'
  conversations: ['fixture-1', 'fixture-2']
  shas: { initial: string; preTrailer: string; trailer: string }
}

export const REFUSAL_MESSAGE = 'Refusing to seed: OVERDECK_HOME must be an isolated test home'

const HOUR_MS = 3_600_000

async function assertIsolatedHome(): Promise<void> {
  const configured = process.env.OVERDECK_HOME
  if (!configured) throw new Error(REFUSAL_MESSAGE)
  const realHome = join(homedir(), '.overdeck')
  const [resolvedConfigured, resolvedReal] = await Promise.all([
    realpath(configured).catch(() => resolve(configured)),
    realpath(realHome).catch(() => resolve(realHome)),
  ])
  if (resolvedConfigured === resolvedReal) throw new Error(REFUSAL_MESSAGE)
}

async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return stdout.trim()
}

function numberedLines(from: number, to: number): string {
  let out = ''
  for (let n = from; n <= to; n++) out += `Line ${n}\n`
  return out
}

function dateEnv(date: Date): Record<string, string> {
  const iso = date.toISOString()
  return { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }
}

interface TranscriptRecord {
  type: 'user' | 'assistant'
  uuid: string
  parentUuid: string | null
  timestamp: string
  sessionId: string
  cwd: string
  message: { id?: string; role: 'user' | 'assistant'; content: unknown }
}

/** Build a transcript: each entry becomes one record chained by parentUuid. */
function transcript(
  sessionId: string,
  cwd: string,
  entries: Array<{ role: 'user' | 'assistant'; at: Date; content: unknown }>,
): string {
  let parent: string | null = null
  const lines: string[] = []
  entries.forEach((entry, index) => {
    const uuid = randomUUID()
    const record: TranscriptRecord = {
      type: entry.role,
      uuid,
      parentUuid: parent,
      timestamp: entry.at.toISOString(),
      sessionId,
      cwd,
      message: {
        ...(entry.role === 'assistant' ? { id: `msg_${sessionId.slice(0, 8)}_${index}` } : {}),
        role: entry.role,
        content: entry.content,
      },
    }
    parent = uuid
    lines.push(JSON.stringify(record))
  })
  return `${lines.join('\n')}\n`
}

function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return [{ type: 'tool_use', id, name, input }]
}

function toolResult(toolUseId: string, content: string) {
  return [{ type: 'tool_result', tool_use_id: toolUseId, content }]
}

const APP_V1 = "export function main(): string {\n  return 'fixture'\n}\n"
const APP_V2 = "export function main(): string {\n  return 'fixture wired'\n}\n"

export async function seedWorkflowFixture(opts: SeedOptions): Promise<SeedResult> {
  await assertIsolatedHome()
  const now = opts.now ?? new Date()
  const root = resolve(opts.root)
  const originPath = join(root, 'origin.git')
  const repoPath = join(root, 'workflow-fixture')

  // Origin and repo.
  await mkdir(root, { recursive: true })
  await rm(originPath, { recursive: true, force: true })
  await rm(repoPath, { recursive: true, force: true })
  await mkdir(originPath, { recursive: true })
  await git(originPath, ['init', '--bare', '-b', 'main'])
  await mkdir(repoPath, { recursive: true })
  await git(repoPath, ['init', '-b', 'main'])
  await git(repoPath, ['config', 'user.name', 'Fixture'])
  await git(repoPath, ['config', 'user.email', 'fixture@example.invalid'])
  await git(repoPath, ['config', 'commit.gpgsign', 'false'])
  await git(repoPath, ['remote', 'add', 'origin', originPath])

  // Commit 1 (now - 3 h): README, .gitignore, docs/shared.md.
  await writeFile(join(repoPath, '.gitignore'), 'build/\n')
  await writeFile(join(repoPath, 'README.md'), '# Workflow fixture\n\nSeeded by scripts/dev/seed-workflow-fixture.ts.\n')
  await mkdir(join(repoPath, 'docs'), { recursive: true })
  await writeFile(join(repoPath, 'docs', 'shared.md'), numberedLines(1, 20))
  await git(repoPath, ['add', '.gitignore', 'README.md', 'docs/shared.md'])
  await git(repoPath, ['commit', '-q', '-m', 'chore: initial fixture'], dateEnv(new Date(now.getTime() - 3 * HOUR_MS)))
  const initial = await git(repoPath, ['rev-parse', 'HEAD'])

  // Commit 2 (now - 2 h): the pre-trailer commit, tied to fixture-1 by its tool output.
  const commit2At = new Date(now.getTime() - 2 * HOUR_MS)
  await mkdir(join(repoPath, 'src'), { recursive: true })
  await writeFile(join(repoPath, 'src', 'app.ts'), APP_V1)
  await git(repoPath, ['add', 'src/app.ts'])
  await git(repoPath, ['commit', '-q', '-m', 'feat: add app entry'], dateEnv(commit2At))
  const preTrailer = await git(repoPath, ['rev-parse', 'HEAD'])
  const preTrailerShort = await git(repoPath, ['rev-parse', '--short', 'HEAD'])
  await git(repoPath, ['push', '-q', '-u', 'origin', 'main'])

  // Commit 3 (now - 1 h): local only, with the conversation trailer.
  const commit3At = new Date(now.getTime() - HOUR_MS)
  await writeFile(join(repoPath, 'src', 'app.ts'), APP_V2)
  await git(repoPath, ['add', 'src/app.ts'])
  await git(
    repoPath,
    ['commit', '-q', '-m', 'feat: wire the fixture conversation', '-m', 'Overdeck-Conversation: conv-fixture-1'],
    dateEnv(commit3At),
  )
  const trailer = await git(repoPath, ['rev-parse', 'HEAD'])

  // Uncommitted: fixture-1 wrote lines 21-24, fixture-2 lines 25-26; build/ is ignored.
  const fixture1Lines = numberedLines(21, 24)
  const fixture2Lines = numberedLines(25, 26)
  await appendFile(join(repoPath, 'docs', 'shared.md'), fixture1Lines + fixture2Lines)
  await mkdir(join(repoPath, 'build'), { recursive: true })
  await writeFile(join(repoPath, 'build', 'output.txt'), 'build output\n')

  // Project and conversations.
  registerProject('workflow-fixture', { name: 'Workflow fixture', path: repoPath, issue_prefix: 'WFX' })
  const uuid1 = randomUUID()
  const uuid2 = randomUUID()
  createConversation({
    name: 'fixture-1',
    cwd: repoPath,
    harness: 'claude-code',
    title: 'Fixture conversation',
    tmuxSession: 'conv-fixture-1',
    claudeSessionId: uuid1,
    projectKey: 'workflow-fixture',
    workspaceId: null,
  })
  createConversation({
    name: 'fixture-2',
    cwd: repoPath,
    harness: 'claude-code',
    title: 'Second fixture conversation',
    tmuxSession: 'conv-fixture-2',
    claudeSessionId: uuid2,
    projectKey: 'workflow-fixture',
    workspaceId: null,
  })
  markConversationEnded('fixture-1', now.getTime())
  markConversationEnded('fixture-2', now.getTime())

  // Transcripts. The commit turn is 30 s before commit 2's date.
  const transcriptDir = claudeProjectDir(repoPath, claudeProjectsRoot(opts.home))
  await mkdir(transcriptDir, { recursive: true })
  const at = (ms: number) => new Date(ms)
  const c2 = commit2At.getTime()
  const appPath = join(repoPath, 'src', 'app.ts')
  const sharedPath = join(repoPath, 'docs', 'shared.md')
  await writeFile(
    join(transcriptDir, `${uuid1}.jsonl`),
    transcript(uuid1, repoPath, [
      { role: 'user', at: at(c2 - 120_000), content: 'Add the app entry, wire it, and extend the shared notes.' },
      { role: 'assistant', at: at(c2 - 90_000), content: toolUse('toolu_write_app', 'Write', { file_path: appPath, content: APP_V1 }) },
      { role: 'user', at: at(c2 - 85_000), content: toolResult('toolu_write_app', `File created successfully at: ${appPath}`) },
      {
        role: 'assistant',
        at: at(c2 - 30_000),
        content: toolUse('toolu_commit_app', 'Bash', { command: 'git add src/app.ts && git commit -m "feat: add app entry"' }),
      },
      {
        role: 'user',
        at: at(c2 - 29_000),
        content: toolResult('toolu_commit_app', `[main ${preTrailerShort}] feat: add app entry\n 1 file changed, 3 insertions(+)`),
      },
      {
        role: 'assistant',
        at: at(commit3At.getTime() - 60_000),
        content: toolUse('toolu_edit_app', 'Edit', { file_path: appPath, old_string: "return 'fixture'", new_string: "return 'fixture wired'" }),
      },
      { role: 'user', at: at(commit3At.getTime() - 55_000), content: toolResult('toolu_edit_app', `The file ${appPath} has been updated.`) },
      {
        role: 'assistant',
        at: at(now.getTime() - 30 * 60_000),
        content: toolUse('toolu_multiedit_shared', 'MultiEdit', {
          file_path: sharedPath,
          edits: [{ old_string: 'Line 20\n', new_string: `Line 20\n${fixture1Lines}` }],
        }),
      },
      { role: 'user', at: at(now.getTime() - 30 * 60_000 + 5_000), content: toolResult('toolu_multiedit_shared', `Applied 1 edit to ${sharedPath}`) },
    ]),
  )
  await writeFile(
    join(transcriptDir, `${uuid2}.jsonl`),
    transcript(uuid2, repoPath, [
      { role: 'user', at: at(now.getTime() - 20 * 60_000), content: 'Add two more lines to the shared notes.' },
      {
        role: 'assistant',
        at: at(now.getTime() - 19 * 60_000),
        content: toolUse('toolu_edit_shared', 'Edit', {
          file_path: sharedPath,
          old_string: 'Line 24\n',
          new_string: `Line 24\n${fixture2Lines}`,
        }),
      },
      { role: 'user', at: at(now.getTime() - 19 * 60_000 + 5_000), content: toolResult('toolu_edit_shared', `The file ${sharedPath} has been updated.`) },
    ]),
  )

  return {
    repoPath,
    originPath,
    projectKey: 'workflow-fixture',
    conversations: ['fixture-1', 'fixture-2'],
    shas: { initial, preTrailer, trailer },
  }
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const root = argValue(args, '--root')
  if (!root) {
    console.error('usage: node --import tsx scripts/dev/seed-workflow-fixture.ts --root <dir> [--home <dir>]')
    process.exit(2)
  }
  const home = argValue(args, '--home') ?? process.env.HOME ?? homedir()
  seedWorkflowFixture({ root, home })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
