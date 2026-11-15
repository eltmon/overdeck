/**
 * Code pane header (PAN-5187, FR-7; PAN-5290 FR-1…FR-3): a breadcrumb of the
 * root label and the path segments, Edit / Preview for markdown files and text
 * files a viewer can show (CSV, SVG), the File / Changes mode tabs, the
 * word-wrap toggle, Keep open for a preview tab and Reveal in files. The
 * sub-tab markup follows EditorPane.tsx.
 */
import { Fragment } from 'react'
import { LocateFixed } from 'lucide-react'
import styles from '../../Stage/stage.module.css'

export type CodePaneView = 'edit' | 'preview'

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path)
}

const TOGGLE = 'rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'
const TOGGLE_ON = 'bg-muted text-foreground'

export interface CodePaneHeaderProps {
  path: string
  /** The human name of the pane's root (useRootLabel), shown first in the breadcrumb. */
  rootLabel: string
  /** Show Edit / Preview; defaults to markdown files only. */
  previewable?: boolean
  view: CodePaneView
  onView(view: CodePaneView): void
  wordWrap: 'on' | 'off'
  onToggleWrap(): void
  /** Absent until the Changes view is available for this pane. */
  changes?: boolean
  onToggleChanges?: () => void
  preview: boolean
  onKeepOpen(): void
  /** Make this pane active and reveal its file in the dock's Files tab; absent outside a Stage. */
  onReveal?: () => void
}

export function CodePaneHeader(props: CodePaneHeaderProps) {
  const { path, rootLabel, view, onView, wordWrap, onToggleWrap, changes, onToggleChanges, preview, onKeepOpen, onReveal } = props
  const markdown = props.previewable ?? isMarkdownPath(path)
  const segments = path.split('/').filter(Boolean)
  return (
    <div className={`${styles.subTabs} items-center`} data-testid="code-pane-header">
      <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground" title={path} data-testid="code-pane-breadcrumb">
        <span>{rootLabel}</span>
        {segments.map((segment, i) => (
          <Fragment key={i}>
            <span aria-hidden>›</span>
            <span className={i === segments.length - 1 ? 'text-foreground' : undefined}>{segment}</span>
          </Fragment>
        ))}
      </span>
      {onToggleChanges ? (
        <div role="tablist" aria-label="Mode" className="flex">
          <button
            type="button"
            role="tab"
            aria-selected={changes !== true}
            className={`${styles.subTab} ${changes !== true ? styles.subTabActive : ''}`}
            onClick={() => {
              if (changes) onToggleChanges()
            }}
          >
            File
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={changes === true}
            title="Show changes against HEAD"
            className={`${styles.subTab} ${changes ? styles.subTabActive : ''}`}
            onClick={() => {
              if (!changes) onToggleChanges()
            }}
          >
            Changes
          </button>
        </div>
      ) : null}
      {markdown ? (
        <div role="tablist" aria-label="View" className="flex">
          {(['edit', 'preview'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`${styles.subTab} ${view === v ? styles.subTabActive : ''}`}
              onClick={() => onView(v)}
            >
              {v === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>
      ) : null}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        aria-pressed={wordWrap === 'on'}
        title="Word wrap (Alt+Z)"
        className={`${TOGGLE} ${wordWrap === 'on' ? TOGGLE_ON : ''}`}
        onClick={onToggleWrap}
      >
        Wrap
      </button>
      {preview ? (
        <button type="button" className={TOGGLE} onClick={onKeepOpen}>
          Keep open
        </button>
      ) : null}
      {onReveal ? (
        <button type="button" aria-label="Reveal in files" title="Reveal in files" className={TOGGLE} onClick={onReveal}>
          <LocateFixed size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
