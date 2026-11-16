import { useState, useCallback, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import styles from '../styles/command-deck.module.css';

interface TranscriptUploadProps {
  issueId: string;
  onClose: () => void;
}

export function TranscriptUpload({ issueId, onClose }: TranscriptUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadType, setUploadType] = useState<'transcript' | 'note'>('transcript');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt') && !file.name.endsWith('.vtt')) {
      setUploadResult('Only .md, .txt, and .vtt files are supported');
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const content = await file.text();
      const res = await fetch(`/api/command-deck/planning/${issueId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: uploadType,
          filename: file.name,
          content,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      setUploadResult(`Uploaded ${file.name} as ${uploadType}`);
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [issueId, uploadType, onClose]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  return (
    <Modal title="Upload Artifact" size="narrow" onClose={onClose}>
      <div className={formStyles.content}>
        {/* Type selection */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className={formStyles.button}
            style={uploadType === 'transcript' ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : {}}
            onClick={() => setUploadType('transcript')}
          >
            Transcript
          </button>
          <button
            type="button"
            className={formStyles.button}
            style={uploadType === 'note' ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : {}}
            onClick={() => setUploadType('note')}
          >
            Note
          </button>
        </div>

        {/* Drop zone */}
        <div
          className={`${styles.uploadZone} ${dragActive ? styles.uploadZoneActive : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className={styles.uploadIcon}>
            {uploading ? (
              <FileText size={32} className={styles.spinning} />
            ) : (
              <Upload size={32} />
            )}
          </div>
          <p className={styles.uploadText}>
            {uploading ? 'Uploading...' : 'Drop a file here or click to browse'}
          </p>
          <p className={styles.uploadHint}>Accepts .md, .txt, and .vtt files</p>
        </div>

        {/* `hidden` (not display: none) keeps the input out of Modal's Tab trap. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.vtt"
          onChange={handleFileSelect}
          hidden
        />

        {uploadResult && (
          <p
            className={uploadResult.startsWith('Error') ? formStyles.error : formStyles.status}
            style={{
              marginTop: '12px',
              color: uploadResult.startsWith('Error') ? 'var(--destructive)' : 'var(--success)',
            }}
          >
            {uploadResult}
          </p>
        )}
      </div>
    </Modal>
  );
}
