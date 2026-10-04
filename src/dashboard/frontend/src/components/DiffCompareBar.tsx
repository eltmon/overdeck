/**
 * Diff compare bar — base/head ref pickers for the diff panel's Compare view
 * (PAN-4503). Suggestions come from GET /api/diffs/refs; the operator can also
 * type any ref git understands (branch, tag, SHA, HEAD~2).
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { buildDiffFetchUrl } from '../lib/diffRouteSearch'
import { cn } from '../lib/utils'

export type DiffCompareMode = 'two-dot' | 'three-dot'

interface RepoRefs {
  branches: Array<{ name: string; sha: string; remote: boolean }>
  tags: Array<{ name: string; sha: string }>
  commits: Array<{ sha: string; shortSha: string; subject: string; date: string }>
}

interface DiffCompareBarProps {
  repoPath: string
  base: string
  head: string
  mode: DiffCompareMode
  /** Compare request error to show under the inputs. */
  error?: string | null
  onApply(next: { base: string; head: string; mode: DiffCompareMode }): void
}

async function fetchRefs(repoPath: string): Promise<RepoRefs> {
  const res = await fetch(buildDiffFetchUrl('/api/diffs/refs', { repo: repoPath }))
  const body = await res.json().catch(() => null) as (RepoRefs & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error ?? 'Failed to load refs')
  return body as RepoRefs
}

const inputClass =
  'h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-background/70 px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:border-border focus:outline-none'

function ModeButton(props: { pressed: boolean; label: string; ariaLabel: string; title: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      aria-pressed={props.pressed}
      title={props.title}
      onClick={props.onClick}
      className={cn(
        'h-7 rounded-md border px-2 font-mono text-[11px] transition-colors',
        props.pressed
          ? 'border-border bg-accent text-accent-foreground'
          : 'border-border/70 bg-background/70 text-muted-foreground hover:border-border hover:text-foreground/80',
      )}
    >
      {props.label}
    </button>
  )
}

export function DiffCompareBar({ repoPath, base, head, mode, error, onApply }: DiffCompareBarProps) {
  // React ids contain ':', which is not valid in the CSS selector some DOMs build from `list`.
  const listId = `diff-compare-refs-${useId().replace(/:/g, '')}`
  const [baseInput, setBaseInput] = useState(base)
  const [headInput, setHeadInput] = useState(head || 'HEAD')
  const [modeInput, setModeInput] = useState<DiffCompareMode>(mode)

  // Follow the applied selection when it changes from outside (URL navigation).
  useEffect(() => setBaseInput(base), [base])
  useEffect(() => setHeadInput(head || 'HEAD'), [head])
  useEffect(() => setModeInput(mode), [mode])

  const { data: refs, error: refsError } = useQuery({
    queryKey: ['diff-refs', repoPath],
    queryFn: () => fetchRefs(repoPath),
  })

  const trimmedBase = baseInput.trim()
  const trimmedHead = headInput.trim()
  const canApply = trimmedBase.length > 0 && trimmedHead.length > 0
  const apply = () => {
    if (canApply) onApply({ base: trimmedBase, head: trimmedHead, mode: modeInput })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') apply()
  }
  const message = error ?? (refsError instanceof Error ? refsError.message : null)

  return (
    <div className="shrink-0 border-b border-border/70 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <input
          className={inputClass}
          list={listId}
          value={baseInput}
          onChange={(event) => setBaseInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="base ref"
          aria-label="Compare base ref"
          spellCheck={false}
        />
        <ModeButton
          pressed={modeInput === 'two-dot'}
          label="A..B"
          ariaLabel="Two-dot compare"
          title="Every difference between base and head"
          onClick={() => setModeInput('two-dot')}
        />
        <ModeButton
          pressed={modeInput === 'three-dot'}
          label="A...B"
          ariaLabel="Three-dot compare"
          title="Only head's changes since it diverged from base"
          onClick={() => setModeInput('three-dot')}
        />
        <input
          className={inputClass}
          list={listId}
          value={headInput}
          onChange={(event) => setHeadInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="head ref"
          aria-label="Compare head ref"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="h-7 rounded-md border border-border/70 bg-background/70 px-2 text-[11px] text-foreground/90 transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          Compare
        </button>
      </div>
      <datalist id={listId}>
        {refs?.branches.map((branch) => (
          <option key={`branch:${branch.name}`} value={branch.name}>{branch.remote ? 'remote branch' : 'branch'}</option>
        ))}
        {refs?.tags.map((tag) => (
          <option key={`tag:${tag.name}`} value={tag.name}>tag</option>
        ))}
        {refs?.commits.map((commit) => (
          <option key={`commit:${commit.sha}`} value={commit.shortSha}>{commit.subject}</option>
        ))}
      </datalist>
      {message && <p className="mt-1 px-1 text-[11px] text-red-400">{message}</p>}
    </div>
  )
}
