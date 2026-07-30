/**
 * New Workspace dialog (PAN-3330 WI-3).
 *
 * The signature behavior is resolve-before-create: every settled field change
 * is sent to POST /api/workspace-registry/resolve, which runs the same
 * resolution the real create runs, and the preview panel shows exactly what
 * confirming will produce — final path, branch created or observed, inferred
 * parent branch, git posture. Validation is never duplicated client-side; the
 * name rule and every other rejection arrive as resolver `findings` and are
 * rendered against the field that caused them (D-9).
 *
 * Chrome is cloned from NewProjectModal (CSS-module overlay/dialog,
 * dashboardMutationJsonHeaders, fetchWithTimeout) rather than introducing a
 * second dialog framework (D-8).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, FolderPlus } from 'lucide-react';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport.js';
import { FolderPicker } from './FolderPicker.js';
import styles from './styles/command-deck.module.css';

/** Milliseconds a field must settle before the preview re-resolves. */
export const RESOLVE_DEBOUNCE_MS = 300;

export interface WorkspaceIntentFinding {
  field: 'name' | 'project' | 'targetPath' | 'parentBranch';
  code: string;
  message: string;
  detail?: string;
}

export interface ResolvedWorkspaceIntent {
  projectId: string | null;
  kind: string;
  name: string;
  path: string | null;
  branchName: string | null;
  parentBranch: string | null;
  parentBranchGuessed: boolean;
  isGitRepository: boolean;
  wouldCreateWorktree: boolean;
  unregisteredTargetPath: boolean;
  findings: WorkspaceIntentFinding[];
}

interface RegisteredProject {
  key: string;
  name: string;
}

interface ProjectTargets {
  primaryPath: string;
  targets: Array<{ path: string }>;
}

export interface NewWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired with the new workspace id once creation succeeds. */
  onCreated: (workspaceId: string) => void;
  /** Preselects a project — used by the per-project entry point. */
  presetProjectKey?: string | null;
}

type Mode = 'shared' | 'isolated';

const BROWSE_OPTION = '__browse__';

const labelStyle = { fontSize: 12, color: 'var(--muted-foreground)' } as const;
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
const monoStyle = { fontFamily: 'var(--font-mono, monospace)' } as const;

export function NewWorkspaceModal({ isOpen, onClose, onCreated, presetProjectKey }: NewWorkspaceModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [projectKey, setProjectKey] = useState(presetProjectKey ?? '');
  const [mode, setMode] = useState<Mode>('shared');
  const [targetPath, setTargetPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [parentBranch, setParentBranch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [projectTargets, setProjectTargets] = useState<ProjectTargets | null>(null);

  const [intent, setIntent] = useState<ResolvedWorkspaceIntent | null>(null);
  const [stale, setStale] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against an in-flight resolve landing after a newer one and
  // overwriting the preview with an outdated intent.
  const resolveSeq = useRef(0);

  // ─── Project list ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithTimeout('/api/registered-projects', { credentials: 'include' });
        if (cancelled || !res?.ok) return;
        const list = (await res.json()) as RegisteredProject[];
        if (cancelled) return;
        setProjects(list);
        // D-3: default to the sole registered project, else the preset, else
        // force an explicit choice — a browser has no cwd to infer from.
        setProjectKey((prev) => prev || presetProjectKey || (list.length === 1 ? (list[0]?.key ?? '') : ''));
      } catch { /* the select simply stays empty — resolve reports the ambiguity */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen, presetProjectKey]);

  // ─── Registered target paths for the chosen project ───────────────────────
  useEffect(() => {
    if (!isOpen || !projectKey) { setProjectTargets(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithTimeout(
          `/api/workspace-registry/project-targets?project=${encodeURIComponent(projectKey)}`,
          { credentials: 'include' },
        );
        if (cancelled || !res?.ok) return;
        const data = (await res.json()) as ProjectTargets;
        if (cancelled) return;
        setProjectTargets(data);
        setTargetPath((prev) => prev || data.primaryPath);
      } catch { /* falls back to Browse… */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen, projectKey]);

  // ─── Debounced resolve-before-create ──────────────────────────────────────
  const effectiveTargetPath = mode === 'isolated' ? '' : targetPath;

  useEffect(() => {
    if (!isOpen) return;
    setStale(true);
    const seq = ++resolveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetchWithTimeout('/api/workspace-registry/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify({
              project: projectKey,
              name,
              isolated: mode === 'isolated',
              ...(effectiveTargetPath ? { targetPath: effectiveTargetPath } : {}),
              ...(parentBranch ? { parentBranch } : {}),
            }),
          });
          if (seq !== resolveSeq.current) return;
          if (!res?.ok) { setStale(false); return; }
          setIntent((await res.json()) as ResolvedWorkspaceIntent);
          setStale(false);
        } catch {
          if (seq === resolveSeq.current) setStale(false);
        }
      })();
    }, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOpen, name, projectKey, mode, effectiveTargetPath, parentBranch]);

  const findingsFor = useCallback(
    (field: WorkspaceIntentFinding['field']) => (intent?.findings ?? []).filter((f) => f.field === field),
    [intent],
  );

  const targetOptions = useMemo(() => {
    if (!projectTargets) return [] as string[];
    const seen = new Set<string>();
    return [projectTargets.primaryPath, ...projectTargets.targets.map((t) => t.path)].filter((path) => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  }, [projectTargets]);

  const hasFindings = (intent?.findings.length ?? 0) > 0;
  const canCreate = !creating && !stale && Boolean(intent) && !hasFindings;

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetchWithTimeout('/api/workspace-registry', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({
          project: projectKey,
          name,
          isolated: mode === 'isolated',
          ...(effectiveTargetPath ? { targetPath: effectiveTargetPath } : {}),
          ...(parentBranch ? { parentBranch } : {}),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { findings?: WorkspaceIntentFinding[]; error?: string };
        if (json.findings?.length) {
          setIntent((prev) => (prev ? { ...prev, findings: json.findings as WorkspaceIntentFinding[] } : prev));
          setError(json.findings[0]?.message ?? 'The workspace intent was rejected.');
        } else {
          setError(json.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      const created = (await res.json()) as { id: string };
      onCreated(created.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className={styles.forkHelpOverlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        data-testid="new-workspace-modal"
        className={styles.forkHelpDialog}
        role="dialog"
        aria-labelledby="new-workspace-title"
      >
        <div className={styles.forkHeader}>
          <div className={styles.forkHeaderLeft}>
            <FolderPlus size={16} className={styles.forkHeaderIcon} />
            <h3 id="new-workspace-title" className={styles.forkTitle}>New workspace</h3>
          </div>
          <button className={styles.forkClose} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className={styles.forkHelpBody}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Name */}
            <div style={fieldStyle} data-testid="new-workspace-name-field">
              <label htmlFor="new-workspace-name" style={labelStyle}>Name</label>
              <input
                id="new-workspace-name"
                data-testid="new-workspace-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.forkTitleInput}
                placeholder="lens"
                autoFocus
              />
              {findingsFor('name').map((finding) => (
                <div key={finding.code} data-testid="new-workspace-finding-name" className={styles.forkWarning}>
                  {finding.message}
                </div>
              ))}
            </div>

            {/* Project */}
            <div style={fieldStyle} data-testid="new-workspace-project-field">
              <label htmlFor="new-workspace-project" style={labelStyle}>Project</label>
              <select
                id="new-workspace-project"
                data-testid="new-workspace-project-select"
                value={projectKey}
                onChange={(e) => { setProjectKey(e.target.value); setTargetPath(''); }}
              >
                <option value="">Select a project…</option>
                {projects.map((project) => (
                  <option key={project.key} value={project.key}>{project.name}</option>
                ))}
              </select>
              {findingsFor('project').map((finding) => (
                <div key={finding.code} data-testid="new-workspace-finding-project" className={styles.forkWarning}>
                  {finding.message}
                </div>
              ))}
            </div>

            {/* Mode */}
            <div style={fieldStyle}>
              <span style={labelStyle}>Mode</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['shared', 'isolated'] as Mode[]).map((candidate) => (
                  <button
                    key={candidate}
                    data-testid={`new-workspace-mode-${candidate}`}
                    aria-pressed={mode === candidate}
                    onClick={() => setMode(candidate)}
                    style={{
                      background: 'none',
                      border: `1px solid ${mode === candidate ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: 2,
                      cursor: 'pointer',
                      padding: '4px 10px',
                      fontSize: 12,
                      color: mode === candidate ? 'var(--foreground)' : 'var(--muted-foreground)',
                    }}
                  >
                    {candidate === 'shared' ? 'Shared directory' : 'Isolated worktree'}
                  </button>
                ))}
              </div>
            </div>

            {/* Target directory — derived (and so disabled) in isolated mode */}
            <div style={fieldStyle} data-testid="new-workspace-target-field">
              <label htmlFor="new-workspace-target" style={labelStyle}>Target directory</label>
              <select
                id="new-workspace-target"
                data-testid="new-workspace-target-select"
                value={targetPath}
                disabled={mode === 'isolated'}
                onChange={(e) => {
                  if (e.target.value === BROWSE_OPTION) { setBrowsing(true); return; }
                  setBrowsing(false);
                  setTargetPath(e.target.value);
                }}
              >
                {targetOptions.map((path) => (
                  <option key={path} value={path}>{path}</option>
                ))}
                <option value={BROWSE_OPTION}>Browse…</option>
              </select>
              {browsing && mode === 'shared' && (
                <FolderPicker onSelect={(path) => { setTargetPath(path); setBrowsing(false); }} />
              )}
              {findingsFor('targetPath').map((finding) => (
                <div key={finding.code} data-testid="new-workspace-finding-targetPath" className={styles.forkWarning}>
                  {finding.message}
                </div>
              ))}
            </div>

            {/* Advanced */}
            <div style={fieldStyle}>
              <button
                data-testid="new-workspace-advanced-toggle"
                onClick={() => setShowAdvanced((prev) => !prev)}
                style={{ ...labelStyle, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                {showAdvanced ? '▾' : '▸'} Advanced
              </button>
              {showAdvanced && (
                <input
                  data-testid="new-workspace-parent-branch-input"
                  type="text"
                  value={parentBranch}
                  onChange={(e) => setParentBranch(e.target.value)}
                  className={styles.forkTitleInput}
                  placeholder={intent?.parentBranch ?? 'parent branch'}
                  aria-label="Parent branch"
                />
              )}
            </div>

            {/* Resolve-before-create preview */}
            <div data-testid="new-workspace-preview" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={labelStyle}>{stale ? 'Resolving…' : 'Will create'}</span>
              {intent && !stale && (
                <>
                  <div data-testid="new-workspace-preview-path" style={{ ...monoStyle, color: 'var(--foreground)' }}>
                    {intent.path ?? '—'}
                  </div>
                  <div data-testid="new-workspace-preview-branch" style={monoStyle}>
                    {intent.branchName
                      ? `creates ${intent.branchName}`
                      : intent.parentBranch
                        ? `on ${intent.parentBranch}`
                        : 'no branch'}
                  </div>
                  <div data-testid="new-workspace-preview-parent" style={labelStyle}>
                    {intent.parentBranch
                      ? `parent ${intent.parentBranch}${intent.parentBranchGuessed ? ' (inferred)' : ''}`
                      : 'no parent branch'}
                  </div>
                  <div data-testid="new-workspace-preview-git" style={labelStyle}>
                    {intent.isGitRepository ? 'git repository' : 'not a git repository'}
                    {intent.wouldCreateWorktree ? ' · creates a worktree' : ''}
                  </div>
                  {intent.unregisteredTargetPath && (
                    <div data-testid="new-workspace-preview-unregistered" style={labelStyle}>
                      Not a registered target for this project.
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div data-testid="new-workspace-error" className={styles.forkWarning}>{error}</div>
            )}
          </div>
        </div>

        <div className={styles.forkFooter}>
          <button data-testid="new-workspace-cancel" className={styles.forkCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="new-workspace-create"
            className={styles.forkConfirmBtn}
            disabled={!canCreate}
            onClick={handleCreate}
          >
            <FolderPlus size={13} />
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
