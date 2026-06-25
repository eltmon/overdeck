/**
 * Dialog for importing conversations from the pre-rebrand ~/.panopticon/panopticon.db
 * into the live overdeck.db. Accessible from Settings > Experimental.
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport.js';

interface PreviewRow {
  name: string;
  title: string | null;
  createdAt: string;
  model: string | null;
  alreadyImported: boolean;
  hasFavorite: boolean;
  claudeSessionId: string | null;
  lastActivityAt: string | null;
  messageCount: number | null;
}

interface PreviewResponse {
  found: true;
  path: string;
  conversations: PreviewRow[];
}

interface PreviewNotFound {
  found: false;
  defaultPath: string;
  message: string;
}

interface ImportResult {
  imported: string[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
  warnings: { name: string; reason: string }[];
  favoritesCarried: number;
}

export interface LegacyImportDialogProps {
  open: boolean;
  onClose: () => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'not-found'; defaultPath: string; message: string; customPath: string }
  | { kind: 'preview'; path: string; rows: PreviewRow[]; selected: Set<string> }
  | { kind: 'importing' }
  | { kind: 'done'; result: ImportResult };

export function LegacyImportDialog({ open, onClose }: LegacyImportDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'loading' });
    void load(undefined);
  }, [open]);

  async function load(customPath: string | undefined) {
    setPhase({ kind: 'loading' });
    try {
      const url = customPath
        ? `/api/settings/legacy-import/conversations?path=${encodeURIComponent(customPath)}`
        : '/api/settings/legacy-import/conversations';
      const res = await fetch(url);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as PreviewResponse | PreviewNotFound;
      if (!body.found) {
        setPhase({
          kind: 'not-found',
          defaultPath: body.defaultPath,
          message: body.message,
          customPath: customPath ?? '',
        });
      } else {
        const selected = new Set(
          body.conversations.filter((r) => !r.alreadyImported).map((r) => r.name),
        );
        setPhase({ kind: 'preview', path: body.path, rows: body.conversations, selected });
      }
    } catch (err) {
      setPhase({
        kind: 'not-found',
        defaultPath: '',
        message: `Failed to load preview: ${err instanceof Error ? err.message : String(err)}`,
        customPath: customPath ?? '',
      });
    }
  }

  async function runImport() {
    if (phase.kind !== 'preview') return;
    const { path, selected } = phase;
    setPhase({ kind: 'importing' });
    try {
      const headers = await dashboardMutationJsonHeaders();
      const res = await fetch('/api/settings/legacy-import/conversations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, names: [...selected] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as ImportResult;
      setPhase({ kind: 'done', result });
    } catch (err) {
      setPhase((prev) =>
        prev.kind === 'importing'
          ? {
              kind: 'not-found',
              defaultPath: '',
              message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
              customPath: '',
            }
          : prev,
      );
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import conversations from old Panopticon"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-foreground">
              Import conversations from old Panopticon
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {phase.kind === 'loading' && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading preview…
            </div>
          )}

          {phase.kind === 'not-found' && (
            <div className="space-y-3">
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {phase.message}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="custom-path">
                  Specify a custom path to the legacy database:
                </label>
                <div className="flex gap-2">
                  <input
                    id="custom-path"
                    type="text"
                    className="flex-1 text-xs bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="/path/to/panopticon.db"
                    defaultValue={phase.customPath}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void load((e.target as HTMLInputElement).value.trim());
                      }
                    }}
                    data-testid="custom-path-input"
                  />
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                    onClick={(e) => {
                      const input = (e.currentTarget.previousSibling as HTMLInputElement);
                      void load(input.value.trim());
                    }}
                  >
                    Load
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase.kind === 'preview' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Source: <span className="font-mono text-foreground">{phase.path}</span>
              </p>

              {phase.rows.length === 0 ? (
                <p className="text-muted-foreground text-xs py-4 text-center">
                  No importable conversations found.
                </p>
              ) : (
                <>
                  {/* Select-all / Select-none controls */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground border-b border-border pb-2">
                    <button
                      type="button"
                      className="hover:text-foreground transition-colors"
                      onClick={() =>
                        setPhase((p) => {
                          if (p.kind !== 'preview') return p;
                          return {
                            ...p,
                            selected: new Set(p.rows.filter((r) => !r.alreadyImported).map((r) => r.name)),
                          };
                        })
                      }
                      data-testid="select-all"
                    >
                      Select all
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      className="hover:text-foreground transition-colors"
                      onClick={() =>
                        setPhase((p) => (p.kind === 'preview' ? { ...p, selected: new Set() } : p))
                      }
                      data-testid="select-none"
                    >
                      Select none
                    </button>
                    <span className="ml-auto text-foreground font-medium">
                      {phase.selected.size} / {phase.rows.filter((r) => !r.alreadyImported).length} selected
                    </span>
                  </div>

                  {/* Row list */}
                  <div className="space-y-1" data-testid="preview-rows">
                    {phase.rows.map((row) => (
                      <label
                        key={row.name}
                        className={`flex items-start gap-2.5 px-2 py-2 rounded-md cursor-pointer transition-colors ${
                          row.alreadyImported
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={row.alreadyImported}
                          checked={phase.selected.has(row.name)}
                          onChange={(e) =>
                            setPhase((p) => {
                              if (p.kind !== 'preview') return p;
                              const next = new Set(p.selected);
                              if (e.target.checked) next.add(row.name);
                              else next.delete(row.name);
                              return { ...p, selected: next };
                            })
                          }
                          className="mt-0.5 shrink-0 accent-primary"
                          data-testid={`row-checkbox-${row.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-foreground text-xs font-medium truncate">
                              {row.title ?? row.name}
                            </span>
                            {row.alreadyImported && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                                data-testid={`already-imported-${row.name}`}
                              >
                                already imported
                              </span>
                            )}
                            {row.hasFavorite && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning shrink-0">
                                ★ favorite
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                            <span>{new Date(row.createdAt).toLocaleDateString()}</span>
                            {row.model && <span>{row.model}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {phase.kind === 'importing' && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Importing conversations…
            </div>
          )}

          {phase.kind === 'done' && (
            <div className="space-y-3" data-testid="import-summary">
              {phase.result.imported.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">{phase.result.imported.length}</span> conversation
                    {phase.result.imported.length !== 1 ? 's' : ''} imported
                    {phase.result.favoritesCarried > 0 && (
                      <span className="text-muted-foreground">
                        {' '}· {phase.result.favoritesCarried} favorite
                        {phase.result.favoritesCarried !== 1 ? 's' : ''} carried over
                      </span>
                    )}
                  </div>
                </div>
              )}
              {phase.result.skipped.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{phase.result.skipped.length}</span> skipped (already present)
                </div>
              )}
              {phase.result.failed.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="font-medium">{phase.result.failed.length} failed</span>
                  </div>
                  {phase.result.failed.map((f) => (
                    <div key={f.name} className="text-[10px] text-muted-foreground ml-4">
                      {f.name}: {f.reason}
                    </div>
                  ))}
                </div>
              )}
              {phase.result.warnings.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-warning font-medium">
                    {phase.result.warnings.length} warning{phase.result.warnings.length !== 1 ? 's' : ''}
                  </div>
                  {phase.result.warnings.map((w, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground ml-4">
                      {w.name}: {w.reason}
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-2 border-t border-border">
                <a
                  href="/conversations"
                  className="text-xs text-primary hover:underline"
                  data-testid="conversations-link"
                >
                  Open Conversations panel →
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors"
          >
            {phase.kind === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'preview' && (
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={phase.selected.size === 0}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              data-testid="import-button"
            >
              Import {phase.selected.size} conversation{phase.selected.size !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
