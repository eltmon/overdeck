import { useState, useRef, useEffect } from 'react';
import { X, FolderPlus } from 'lucide-react';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { FolderPicker } from './FolderPicker.js';
import styles from './styles/command-deck.module.css';

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }

export interface CreatedProject {
  key: string;
  name: string;
  path: string;
}

export interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: CreatedProject) => void;
}

type Mode = 'existing' | 'new';

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('existing');
  const [selectedPath, setSelectedPath] = useState('');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [overdeckDefault, setOverdeckDefault] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch home dir once on open to derive the ~/Overdeck default parent for new projects.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithTimeout('/api/fs/list-dirs', { credentials: 'include' });
        if (cancelled || !res?.ok) return;
        const data = await res.json() as { path: string };
        const d = `${data.path}/Overdeck`;
        setOverdeckDefault(d);
        setParentDir((prev) => prev || d);
      } catch { /* non-fatal — user can pick manually */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const slug = slugify(name.trim());
  const preview = parentDir && name.trim() ? `${parentDir}/${slug}` : '';

  const canStart = !pending && (
    mode === 'existing' ? Boolean(selectedPath) :
    Boolean(name.trim()) && Boolean(parentDir)
  );

  async function handleStart() {
    setError(null);
    setPending(true);
    try {
      const body = mode === 'existing'
        ? { mode: 'existing', path: selectedPath }
        : { mode: 'new', parentDir, name: name.trim() };
      const res = await fetchWithTimeout('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      const project = await res.json() as CreatedProject;
      onCreated(project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
  }

  return (
    <div
      ref={overlayRef}
      className={styles.forkHelpOverlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        data-testid="new-project-modal"
        className={styles.forkHelpDialog}
        role="dialog"
        aria-labelledby="new-project-title"
      >
        <div className={styles.forkHeader}>
          <div className={styles.forkHeaderLeft}>
            <FolderPlus size={16} className={styles.forkHeaderIcon} />
            <h3 id="new-project-title" className={styles.forkTitle}>Add project</h3>
          </div>
          <button className={styles.forkClose} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
          {(['existing', 'new'] as Mode[]).map((m) => (
            <button
              key={m}
              data-testid={`new-project-tab-${m}`}
              onClick={() => switchMode(m)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: mode === m ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                padding: '8px 14px',
                color: mode === m ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontSize: 13,
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'existing' ? 'Add existing' : 'New project'}
            </button>
          ))}
        </div>

        <div className={styles.forkHelpBody}>
          {mode === 'existing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p className={styles.forkDesc}>Browse to the project folder and click Select.</p>
              <FolderPicker onSelect={(path) => setSelectedPath(path)} />
              {selectedPath && (
                <div data-testid="new-project-selected-path" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  Selected: <strong>{selectedPath}</strong>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="new-project-name" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  Project name
                </label>
                <input
                  id="new-project-name"
                  data-testid="new-project-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={styles.forkTitleInput}
                  placeholder="My App"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
                  Parent folder
                </p>
                <FolderPicker
                  onSelect={(path) => setParentDir(path)}
                  initialPath={overdeckDefault || undefined}
                />
              </div>
              {preview && (
                <div
                  data-testid="new-project-preview"
                  style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'monospace' }}
                >
                  {preview}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              data-testid="new-project-error"
              className={styles.forkWarning}
              style={{ marginTop: 8 }}
            >
              {error}
            </div>
          )}
        </div>

        <div className={styles.forkFooter}>
          <button className={styles.forkCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="new-project-start"
            className={styles.forkConfirmBtn}
            disabled={!canStart}
            onClick={handleStart}
          >
            <FolderPlus size={13} />
            {pending ? 'Creating…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
