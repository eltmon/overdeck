import { useState, type ReactNode } from 'react'
import { Pencil, Settings } from 'lucide-react'
import { Modal } from '../../shared/Modal'
import { ProjectSettingsSection } from '../../CommandDeck/ProjectSettingsDisclosure'
import type { ProjectRenameControls } from './useProjectRename'
import styles from './home.module.css'

export interface HomeHeaderProps {
  /** The registered project name, else the deck's project name. */
  title: string
  /** The registered repository (e.g. `eltmon/overdeck`), shown faint beside the title. */
  subtitle?: string
  /** Inline rename controls (PAN-3156); the pencil renders only when given. */
  rename?: ProjectRenameControls
  /** Enables the Settings button and modal; absent on the no-project deck. */
  projectKey?: string
  /** The metadata line (HomeMetaLine) rendered below the title row. */
  meta?: ReactNode
}

/**
 * PAN-5294 G-D2 — the project Home header: title (display-lg) with the
 * rename pencil, the repository subtitle, a Settings button that opens the
 * project settings in a modal, then the metadata line.
 */
export function HomeHeader({ title, subtitle, rename, projectKey, meta }: HomeHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={`display-lg ${styles.title}`}>
          {rename?.editing ? (
            <input
              ref={rename.inputRef}
              className={styles.renameInput}
              value={rename.draftName}
              onChange={(event) => rename.change(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') rename.commit()
                if (event.key === 'Escape') rename.cancel()
              }}
              onBlur={rename.commit}
              aria-label={`Rename ${title}`}
              disabled={rename.pending}
            />
          ) : (
            title
          )}
        </h2>
        {rename && !rename.editing && (
          <button
            type="button"
            className={styles.renameButton}
            onClick={rename.begin}
            title="Rename project"
            aria-label={`Rename ${title}`}
          >
            <Pencil size={14} />
          </button>
        )}
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        {rename?.error && (
          <span role="alert" className={styles.renameError}>{rename.error}</span>
        )}
        {projectKey && (
          <button type="button" className={styles.settingsButton} onClick={() => setSettingsOpen(true)}>
            <Settings size={14} /> Settings
          </button>
        )}
      </div>
      {meta}
      {projectKey && settingsOpen && (
        <Modal title="Project settings" wide onClose={() => setSettingsOpen(false)}>
          <ProjectSettingsSection projectKey={projectKey} />
        </Modal>
      )}
    </header>
  )
}
