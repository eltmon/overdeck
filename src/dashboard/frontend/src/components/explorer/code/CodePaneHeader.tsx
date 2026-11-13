/**
 * Code pane header (PAN-5187, FR-7): the root-relative path, Edit / Preview
 * for markdown files, the word-wrap and Changes toggles, and Keep open for a
 * preview tab. The sub-tab markup follows EditorPane.tsx.
 */
import styles from '../../Stage/stage.module.css'

export type CodePaneView = 'edit' | 'preview'

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path)
}

const TOGGLE = 'rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'
const TOGGLE_ON = 'bg-muted text-foreground'

export interface CodePaneHeaderProps {
  path: string
  view: CodePaneView
  onView(view: CodePaneView): void
  wordWrap: 'on' | 'off'
  onToggleWrap(): void
  /** Absent until the Changes view is available for this pane. */
  changes?: boolean
  onToggleChanges?: () => void
  preview: boolean
  onKeepOpen(): void
}

export function CodePaneHeader(props: CodePaneHeaderProps) {
  const { path, view, onView, wordWrap, onToggleWrap, changes, onToggleChanges, preview, onKeepOpen } = props
  const markdown = isMarkdownPath(path)
  return (
    <div className={`${styles.subTabs} items-center`} data-testid="code-pane-header">
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={path}>
        {path}
      </span>
      {markdown ? (
        <div role="tablist" aria-label="Markdown view" className="flex">
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
      {onToggleChanges ? (
        <button
          type="button"
          aria-pressed={changes === true}
          title="Show changes against HEAD"
          className={`${TOGGLE} ${changes ? TOGGLE_ON : ''}`}
          onClick={onToggleChanges}
        >
          Changes
        </button>
      ) : null}
      {preview ? (
        <button type="button" className={TOGGLE} onClick={onKeepOpen}>
          Keep open
        </button>
      ) : null}
    </div>
  )
}
