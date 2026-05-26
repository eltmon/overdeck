/**
 * WorktreePickerMenu (PAN-1533)
 *
 * Popover anchored to a conversation branch chip. Lists the project's
 * existing worktrees and offers a "Create new worktree…" form. Picking
 * one calls `onSelect` with the absolute worktree path and a short
 * label — the caller (a ConversationRow or ConversationPanel header)
 * opens the existing fork modal pre-seeded with that path.
 *
 * Stops at "fork into a worktree". Does not in-place switch the source
 * conversation's cwd — see the PRD for the rationale (Claude Code's
 * session resume is keyed off cwd).
 *
 * Closes on outside click / Escape, same pattern as ContextWindowMeter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitFork, GitBranchPlus, Folder, AlertCircle, Loader2, Plus, ChevronLeft } from 'lucide-react';
import styles from './WorktreePickerMenu.module.css';

// ─── Wire types ──────────────────────────────────────────────────────────────

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isPrimary: boolean;
  isAgentWorkspace: boolean;
  isConvWorktree: boolean;
}

interface ListWorktreesResponse {
  projectKey: string;
  projectPath: string;
  worktrees: WorktreeEntry[];
}

interface CreateWorktreeResponse {
  path: string;
  branch: string;
  createdBranch: boolean;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchWorktrees(projectKey: string): Promise<ListWorktreesResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/worktrees`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Failed to list worktrees (${res.status})`);
  }
  return res.json();
}

async function createWorktree(opts: {
  projectKey: string;
  slug: string;
  branch: string;
  base?: string;
}): Promise<CreateWorktreeResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(opts.projectKey)}/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: opts.slug, branch: opts.branch, base: opts.base }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Failed to create worktree (${res.status})`);
  }
  return data as CreateWorktreeResponse;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WorktreePickerMenuProps {
  projectKey: string;
  /** Absolute path the source conversation is currently rooted in. */
  currentCwd: string | null | undefined;
  /** Slug for naming any newly-created worktree (typically the source convs name). */
  newWorktreeSlug: string;
  onSelect: (path: string, label: string) => void;
  onClose: () => void;
  /** Where to anchor the popover. Default `bottom-right` (chip lives at the top of the panel). */
  anchor?: 'top-right' | 'bottom-right';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorktreePickerMenu({
  projectKey,
  currentCwd,
  newWorktreeSlug,
  onSelect,
  onClose,
  anchor = 'bottom-right',
}: WorktreePickerMenuProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'list' | 'create'>('list');

  // Outside click / Escape close — same pattern as ContextWindowMeter.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['project-worktrees', projectKey],
    queryFn: () => fetchWorktrees(projectKey),
    staleTime: 15_000,
  });

  return (
    <div
      ref={wrapperRef}
      role="dialog"
      aria-label="Pick or create a worktree"
      className={`${styles.popover} ${styles[`anchor_${anchor}`]}`}
      data-testid="worktree-picker-menu"
    >
      {mode === 'list' && (
        <WorktreeList
          isLoading={isLoading}
          isError={isError}
          errorMessage={isError ? (error instanceof Error ? error.message : String(error)) : null}
          currentCwd={currentCwd ?? null}
          entries={data?.worktrees ?? []}
          onSelect={onSelect}
          onCreate={() => setMode('create')}
        />
      )}
      {mode === 'create' && (
        <CreateWorktreeForm
          projectKey={projectKey}
          slug={newWorktreeSlug}
          onBack={() => setMode('list')}
          onCreated={(created) => {
            const label = created.branch;
            onSelect(created.path, label);
          }}
        />
      )}
    </div>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────

function WorktreeList({
  isLoading,
  isError,
  errorMessage,
  currentCwd,
  entries,
  onSelect,
  onCreate,
}: {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  currentCwd: string | null;
  entries: WorktreeEntry[];
  onSelect: (path: string, label: string) => void;
  onCreate: () => void;
}) {
  // The picker is "fork into a different worktree" — the conv that opened
  // the menu can't usefully fork into itself, so the current cwd is
  // shown disabled. Agent workspaces are visible but disabled too because
  // they're owned by the pipeline; forking a human conv into one would
  // surprise the agent there.
  const ordered = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => {
      // Primary first, then agent workspaces, then conv worktrees, then anything else.
      const rank = (e: WorktreeEntry) =>
        e.isPrimary ? 0 : e.isAgentWorkspace ? 2 : e.isConvWorktree ? 1 : 3;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.branch ?? '').localeCompare(b.branch ?? '');
    });
    return arr;
  }, [entries]);

  if (isLoading) {
    return (
      <div className={styles.empty}>
        <Loader2 size={14} className={styles.spin} /> Loading worktrees…
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.error}>
        <AlertCircle size={14} />
        <span>{errorMessage ?? 'Failed to load worktrees'}</span>
      </div>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <span className={styles.headerLabel}>Fork into worktree</span>
      </header>
      <ul className={styles.list}>
        {ordered.map((entry) => {
          const isCurrent = currentCwd ? entry.path === currentCwd : false;
          const isDisabled = isCurrent || entry.isAgentWorkspace;
          const reason = isCurrent
            ? '(current cwd)'
            : entry.isAgentWorkspace
              ? '(agent workspace)'
              : entry.isConvWorktree
                ? '(conv worktree)'
                : entry.isPrimary
                  ? '(primary)'
                  : null;
          return (
            <li key={entry.path}>
              <button
                type="button"
                className={`${styles.entry} ${isDisabled ? styles.entryDisabled : ''}`}
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  onSelect(entry.path, entry.branch ?? entry.path);
                }}
                data-testid="worktree-picker-entry"
              >
                {entry.isPrimary ? (
                  <Folder size={12} />
                ) : entry.isConvWorktree ? (
                  <GitFork size={12} />
                ) : (
                  <GitFork size={12} />
                )}
                <span className={styles.entryBranch}>{entry.branch ?? '(detached HEAD)'}</span>
                {reason && <span className={styles.entryReason}>{reason}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.createBtn}
          onClick={onCreate}
          data-testid="worktree-picker-create-trigger"
        >
          <Plus size={12} /> Create new worktree…
        </button>
      </footer>
    </>
  );
}

// ─── Create view ──────────────────────────────────────────────────────────────

function CreateWorktreeForm({
  projectKey,
  slug,
  onBack,
  onCreated,
}: {
  projectKey: string;
  slug: string;
  onBack: () => void;
  onCreated: (created: CreateWorktreeResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createWorktree({
        projectKey,
        slug,
        branch: branch.trim(),
        base: base.trim() ? base.trim() : undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project-worktrees', projectKey] });
      onCreated(data);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!branch.trim()) {
        setError('Branch name is required');
        return;
      }
      mutation.mutate();
    },
    [branch, mutation],
  );

  return (
    <form className={styles.form} onSubmit={onSubmit} data-testid="worktree-picker-create-form">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to worktree list"
        >
          <ChevronLeft size={14} />
        </button>
        <span className={styles.headerLabel}>Create new worktree</span>
      </header>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Branch name</span>
        <input
          autoFocus
          className={styles.input}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/my-idea"
          spellCheck={false}
          autoComplete="off"
          disabled={mutation.isPending}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Base (optional)</span>
        <input
          className={styles.input}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="main"
          spellCheck={false}
          autoComplete="off"
          disabled={mutation.isPending}
        />
      </label>

      <p className={styles.helpText}>
        Created at <code>worktrees/conv-{slug}</code>. New branches default to <code>main</code> when no base is given.
      </p>

      {error && (
        <div className={styles.error}>
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}

      <footer className={styles.formFooter}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onBack}
          disabled={mutation.isPending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={mutation.isPending || !branch.trim()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 size={12} className={styles.spin} /> Creating…
            </>
          ) : (
            <>
              <GitBranchPlus size={12} /> Create &amp; fork
            </>
          )}
        </button>
      </footer>
    </form>
  );
}
