import { FileText, Loader2, X } from 'lucide-react';
import type { PendingAttachment } from '../../lib/composerStore';
import styles from '../CommandDeck/styles/command-deck.module.css';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / Math.pow(1000, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface ComposerAttachmentStripProps {
  attachments: PendingAttachment[];
  onOpenImage: (attachment: PendingAttachment) => void;
  onRemove: (id: string) => void;
}

export function ComposerAttachmentStrip({ attachments, onOpenImage, onRemove }: ComposerAttachmentStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={styles.composerImageStrip}>
      {attachments.map((attachment) => {
        const isUploading = !attachment.serverPath && !attachment.error;
        const statusLabel = attachment.error
          ? attachment.error
          : attachment.serverPath
            ? 'Uploaded'
            : 'Uploading…';
        return (
          <div key={attachment.id} className={styles.composerImageCard}>
            {attachment.previewUrl ? (
              <button
                type="button"
                className={styles.composerImageThumbButton}
                onClick={() => onOpenImage(attachment)}
                title={`View ${attachment.file.name}`}
              >
                <img src={attachment.previewUrl} alt={attachment.file.name} className={styles.composerImageThumb} />
              </button>
            ) : (
              <div className={`${styles.composerImageThumb} ${styles.composerFileThumb}`} title={attachment.file.name}>
                <FileText size={16} />
              </div>
            )}
            <div className={styles.composerImageMeta}>
              <span className={styles.composerImageName}>{attachment.file.name}</span>
              <span className={attachment.error ? styles.composerImageError : styles.composerImageStatus}>
                {isUploading ? <Loader2 size={12} className={styles.spinner} /> : null}
                {statusLabel}
                {attachment.kind === 'file' && !attachment.error && (
                  <span className={styles.composerFileSize}>· {formatFileSize(attachment.file.size)}</span>
                )}
              </span>
            </div>
            <button
              type="button"
              className={styles.composerImageRemoveButton}
              onClick={() => onRemove(attachment.id)}
              title={`Remove ${attachment.file.name}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
