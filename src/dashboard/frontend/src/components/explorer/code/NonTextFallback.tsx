/**
 * Shown by a code pane for a binary or large file (PAN-5187). PAN-5188
 * replaces its use with the viewer router.
 */
import styles from '../../Stage/stage.module.css'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function NonTextFallback({ name, size }: { name: string; size: number }) {
  return (
    <div className={styles.placeholder} data-testid="code-pane-non-text">
      <div className={styles.placeholderTitle}>{name}</div>
      <div className={styles.placeholderHint}>
        {formatFileSize(size)}. This file opens in a viewer.
      </div>
    </div>
  )
}
