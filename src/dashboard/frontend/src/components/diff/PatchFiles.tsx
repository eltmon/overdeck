// The FileDiff list renderer (PAN-5289 WI-21, B-D7), extracted unchanged from
// DiffPanel so the work dock's diff view renders patches the same way.
//
// `files` wins over `patch` when both are given. A patch that does not parse
// shows its raw text with the reason. Files sort by path; each file block
// carries `data-diff-file-path` so a caller can scroll to it.
//
// PAN-5418: the conversation All turns patch can hold mbox-style sections
// (`From <sha> …` / `Subject: …`), one per commit. Each file from a section
// gets a plain label row above its diff: `<short sha> <subject>`, or
// `Uncommitted` for the all-zero sha. Files from a plain patch get no label.

import { useMemo } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff, type FileDiffMetadata, Virtualizer } from '@pierre/diffs/react'

import { cn } from '../../lib/utils'
import { useTheme } from '../../hooks/useTheme'
import { useDiffPreferences } from '../../hooks/useDiffPreferences'
import { buildPatchCacheKey, resolveDiffThemeName } from '../../lib/diffRendering'

type DiffThemeType = 'light' | 'dark'

const DIFF_PANEL_UNSAFE_CSS = `
:host {
  /* Pin the diff to our app theme (PAN-1520): @pierre/diffs renders into a shadow
     DOM and switches light/dark via CSS light-dark(), which follows color-scheme.
     Without this, the shadow tree can briefly fall back to the OS prefers-color-scheme
     on first paint before the themeType prop applies (a light flash in dark mode).
     This style is injected last into the shadow, so it wins. */
  color-scheme: var(--pan-color-scheme, light dark);

  /* The --diffs-*-override vars MUST be declared here: the library substitutes
     them in its own :host block (e.g. --diffs-bg-context:
     var(--diffs-bg-context-override, <default>)). Declaring them on descendants
     like [data-diff] is invisible to that substitution — the var resolves at
     :host before inheritance. */
  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  /* Add/remove colors. The library uses these as MIX TARGETS: each changed line
     paints color-mix(in lab, <bg> var(--mix-light|--mix-dark), <target>), so
     these must be PURE accent colors. A pre-diluted blend here gets diluted a
     second time by the line mix and reads as virtually no tint at all. Fill
     strength is controlled by the --mix-* knobs below, not by these colors. */
  --diffs-bg-addition-override: #22c55e;
  --diffs-bg-addition-number-override: #22c55e;
  --diffs-bg-deletion-override: #ef4444;
  --diffs-bg-deletion-number-override: #ef4444;

  /* Word-level emphasis must stay a clear step above the boosted line fill. */
  --diffs-bg-addition-emphasis-override: light-dark(rgb(34 197 94 / 0.40), rgb(34 197 94 / 0.45));
  --diffs-bg-deletion-emphasis-override: light-dark(rgb(239 68 68 / 0.40), rgb(239 68 68 / 0.45));
}

/* Line-fill strength (GitHub-plus). Library defaults: line 88%/80%, gutter
   91%/85%, hover 80%/75% (numbers are the BG share — higher = fainter tint).
   unsafeCSS is injected as an unlayered <style>, so these win over the
   library's @layer base rules; hover must therefore be re-declared to keep
   its step-stronger highlight. */
[data-line-type='change-addition'],
[data-line-type='change-deletion'] {
  --mix-light: 70%;
  --mix-dark: 66%;
}
[data-line-type='change-addition']:where([data-gutter-buffer], [data-column-number]),
[data-line-type='change-deletion']:where([data-gutter-buffer], [data-column-number]) {
  --mix-light: 64%;
  --mix-dark: 60%;
}
@media (pointer: fine) {
  [data-line-type='change-addition'][data-hovered],
  [data-line-type='change-deletion'][data-hovered] {
    --mix-light: 62%;
    --mix-dark: 58%;
  }
}

[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`

// ─── Patch parsing ────────────────────────────────────────────────────────────

export type RenderablePatch =
  | { kind: 'files'; files: FileDiffMetadata[]; labels?: ReadonlyMap<FileDiffMetadata, string> }
  | { kind: 'raw'; text: string; reason: string }

/** PAN-5418 FR-6: the label for a section preamble — `<short sha> <subject>`, `Uncommitted`, or undefined. */
export function sectionLabel(patchMetadata: string | undefined): string | undefined {
  const sha = patchMetadata?.match(/^From ([0-9a-f]{40}) /m)?.[1]
  if (!sha) return undefined
  if (/^0+$/.test(sha)) return 'Uncommitted'
  const subject = patchMetadata?.match(/^Subject: (.*)$/m)?.[1] ?? ''
  return `${sha.slice(0, 7)} ${subject}`.trim()
}

export function getRenderablePatch(
  patch: string | undefined,
  cacheScope = 'diff-panel',
): RenderablePatch | null {
  if (!patch) return null
  const normalizedPatch = patch.trim()
  if (normalizedPatch.length === 0) return null

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    )
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
    if (files.length > 0) {
      const labels = new Map<FileDiffMetadata, string>()
      for (const parsedPatch of parsedPatches) {
        const label = sectionLabel(parsedPatch.patchMetadata)
        if (label === undefined) continue
        for (const file of parsedPatch.files) labels.set(file, label)
      }
      return labels.size > 0 ? { kind: 'files', files, labels } : { kind: 'files', files }
    }

    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Unsupported diff format. Showing raw patch.',
    }
  } catch {
    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Failed to parse patch. Showing raw patch.',
    }
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? ''
  if (raw.startsWith('a/') || raw.startsWith('b/')) {
    return raw.slice(2)
  }
  return raw
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? 'none'}:${fileDiff.name}`
}

export interface PatchFilesProps {
  /** A unified patch; parsed with `cacheScope`. */
  patch?: string
  /** Already-parsed files; wins over `patch`. */
  files?: FileDiffMetadata[]
  cacheScope: string
}

export function PatchFiles({ patch, files, cacheScope }: PatchFilesProps) {
  const { resolvedTheme } = useTheme()
  const { prefs: diffPrefs } = useDiffPreferences()
  const diffWordWrap = diffPrefs.diffWordWrap

  const renderablePatch = useMemo<RenderablePatch | null>(
    () => (files ? { kind: 'files', files } : getRenderablePatch(patch, cacheScope)),
    [files, patch, cacheScope],
  )

  const sortedFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== 'files') return []
    return [...renderablePatch.files].sort((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
  }, [renderablePatch])

  if (!renderablePatch) return null

  if (renderablePatch.kind === 'files') {
    return (
      <Virtualizer
        className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
        config={{
          overscrollSize: 600,
          intersectionObserverMargin: 1200,
        }}
      >
        {sortedFiles.map((fileDiff) => {
          const filePath = resolveFileDiffPath(fileDiff)
          const fileKey = buildFileDiffRenderKey(fileDiff)
          const themedFileKey = `${fileKey}:${resolvedTheme}`
          const label = renderablePatch.labels?.get(fileDiff)
          return (
            <div
              key={themedFileKey}
              data-diff-file-path={filePath}
              className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
            >
              {label && (
                <div data-testid="diff-section-label" className="px-2 pb-1 pt-1 font-mono text-[11px] text-muted-foreground">
                  {label}
                </div>
              )}
              <FileDiff
                fileDiff={fileDiff}
                options={{
                  diffStyle: diffPrefs.diffRenderMode === 'split' ? 'split' : 'unified',
                  lineDiffType: diffPrefs.lineDiffType,
                  overflow: diffPrefs.diffWordWrap ? 'wrap' : 'scroll',
                  diffIndicators: diffPrefs.diffIndicators,
                  hunkSeparators: diffPrefs.hunkSeparators,
                  expandUnchanged: diffPrefs.expandUnchanged,
                  collapsedContextThreshold: diffPrefs.collapsedContextThreshold,
                  lineHoverHighlight: diffPrefs.lineHoverHighlight,
                  disableLineNumbers: diffPrefs.disableLineNumbers,
                  enableLineSelection: diffPrefs.enableLineSelection,
                  theme: resolveDiffThemeName(resolvedTheme),
                  themeType: resolvedTheme as DiffThemeType,
                  unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                }}
              />
            </div>
          )
        })}
      </Virtualizer>
    )
  }

  return (
    <div className="h-full overflow-auto p-2">
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
        <pre
          className={cn(
            'max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90',
            diffWordWrap
              ? 'overflow-auto whitespace-pre-wrap break-words'
              : 'overflow-auto',
          )}
        >
          {renderablePatch.text}
        </pre>
      </div>
    </div>
  )
}
