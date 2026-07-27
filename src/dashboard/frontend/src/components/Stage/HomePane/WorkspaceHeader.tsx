import { GitBranch, Pencil } from 'lucide-react'
import type { ProjectRenameControls } from './useProjectRename'
import styles from '../stage.module.css'

export interface WorkspaceHeaderProps {
  /** Workspace / issue display name (e.g. issue title or workspace name). */
  name: string
  /** Feature branch, e.g. "feature/pan-1549". Omitted for non-agent workspaces. */
  branch?: string
  /** Single-letter badge for the icon tile (e.g. project initial). */
  iconLabel?: string
  /** Renders the "↗ set parent" link when provided. */
  onSetParent?: () => void
  /**
   * Inline project-rename controls (PAN-3156). Renders the pencil beside the
   * title and swaps it for a draft input while editing. Honoured only by
   * `variant='project'`; the issue variant never renders a rename affordance.
   */
  rename?: ProjectRenameControls
  /**
   * 'issue' (default) → icon tile + name + feature branch (PAN-1549 style).
   * 'project' (PAN-1561) → `# <project>` heading with no icon tile, branch is
   * the project's working branch (e.g. `main`).
   */
  variant?: 'issue' | 'project'
}

/**
 * WorkspaceHeader — the HomePane header region (PAN-1549). Absorbs the Zone A
 * issue-header role: icon tile, name, branch line, and an optional set-parent
 * link. PAN-1561 adds a project `variant` that renders `# <project>` + `main`
 * for the project-scoped Home tab. PAN-3156 puts the project rename pencil on
 * that title. Pure presentation; data and rename state come from the Stage
 * mount point.
 */
export function WorkspaceHeader({ name, branch, iconLabel, onSetParent, rename, variant = 'issue' }: WorkspaceHeaderProps) {
  const isProject = variant === 'project'
  const projectRename = isProject ? rename : undefined
  return (
    <div className={styles.wsHead}>
      <div className={styles.wsTitle}>
        {isProject ? (
          <h3 className={styles.wsName}>
            <span className={styles.wsHash}>#</span>{' '}
            {projectRename?.editing ? (
              <input
                ref={projectRename.inputRef}
                className={styles.wsNameInput}
                value={projectRename.draftName}
                onChange={(event) => projectRename.change(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') projectRename.commit()
                  if (event.key === 'Escape') projectRename.cancel()
                }}
                onBlur={projectRename.commit}
                aria-label={`Rename ${name}`}
                disabled={projectRename.pending}
              />
            ) : (
              name
            )}
          </h3>
        ) : (
          <>
            {iconLabel && <span className={styles.wsIcon}>{iconLabel}</span>}
            <h3 className={styles.wsName}>{name}</h3>
          </>
        )}
        {projectRename && !projectRename.editing && (
          <button
            type="button"
            className={styles.wsRename}
            onClick={projectRename.begin}
            title="Rename project"
            aria-label={`Rename ${name}`}
          >
            <Pencil size={14} />
          </button>
        )}
        {projectRename?.error && (
          <span role="alert" className={styles.wsRenameError}>{projectRename.error}</span>
        )}
      </div>
      <div className={styles.wsBranch}>
        {branch && (
          <span className={styles.wsBranchName}>
            <GitBranch size={13} /> {branch}
          </span>
        )}
        {onSetParent && (
          <button type="button" className={styles.wsLink} onClick={onSetParent}>
            ↗ set parent
          </button>
        )}
      </div>
    </div>
  )
}
