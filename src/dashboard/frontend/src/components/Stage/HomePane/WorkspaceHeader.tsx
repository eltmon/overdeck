import { GitBranch } from 'lucide-react'
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
 * for the project-scoped Home tab. Pure presentation; data is supplied by the
 * Stage mount point.
 */
export function WorkspaceHeader({ name, branch, iconLabel, onSetParent, variant = 'issue' }: WorkspaceHeaderProps) {
  const isProject = variant === 'project'
  return (
    <div className={styles.wsHead}>
      <div className={styles.wsTitle}>
        {isProject ? (
          <h3 className={styles.wsName}>
            <span className={styles.wsHash}>#</span> {name}
          </h3>
        ) : (
          <>
            {iconLabel && <span className={styles.wsIcon}>{iconLabel}</span>}
            <h3 className={styles.wsName}>{name}</h3>
          </>
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
