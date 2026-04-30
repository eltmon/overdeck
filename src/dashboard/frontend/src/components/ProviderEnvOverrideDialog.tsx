import { useState, useEffect, useCallback } from 'react';
import { X, ShieldAlert } from 'lucide-react';

export interface ProviderEnvConflict {
  key: string;
  userValue: string;
  proposedValue: string | undefined;
  source: string;
}

interface ProviderEnvOverrideDialogProps {
  conflicts: ProviderEnvConflict[];
  isOpen: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

function maskValue(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

function keyLabel(key: string): string {
  switch (key) {
    case 'ANTHROPIC_BASE_URL': return 'API Base URL';
    case 'ANTHROPIC_API_KEY': return 'API Key';
    case 'ANTHROPIC_AUTH_TOKEN': return 'Auth Token';
    case 'OPENAI_API_KEY': return 'OpenAI Key';
    case 'GEMINI_API_KEY': return 'Gemini Key';
    case 'API_TIMEOUT_MS': return 'Timeout';
    case 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS': return 'Key Helper TTL';
    default: return key;
  }
}

export function ProviderEnvOverrideDialog({
  conflicts,
  isOpen,
  onApprove,
  onCancel,
}: ProviderEnvOverrideDialogProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    requestAnimationFrame(() => setEntered(true));
  }, [isOpen]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className={`bg-popover text-popover-foreground rounded-2xl border border-border shadow-lg w-full max-w-lg mx-4 transition-all duration-200 ease-in-out ${
          entered ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'
        }`}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-warning/10">
              <ShieldAlert className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-foreground">Provider Config Conflict</h3>
              <p className="text-sm text-muted-foreground">Your Claude Code settings override Panopticon&apos;s provider</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {conflicts.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Your <span className="font-mono text-xs text-foreground">~/.claude/settings.json</span> has
                provider env vars that will override Panopticon&apos;s configuration, routing API calls to the wrong endpoint.
              </p>

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs">Variable</th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs">Your Value</th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs">Panopticon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map(c => (
                      <tr key={c.key} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{keyLabel(c.key)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-destructive/80 break-all">
                          {c.key.includes('KEY') || c.key.includes('TOKEN')
                            ? maskValue(c.userValue)
                            : c.userValue}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-success/80 break-all">
                          {c.proposedValue
                            ? c.key.includes('KEY') || c.key.includes('TOKEN')
                              ? maskValue(c.proposedValue)
                              : c.proposedValue
                            : <span className="text-muted-foreground italic">unset</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Panopticon will inject overrides into the project-level{' '}
                <span className="font-mono">.claude/settings.local.json</span>.
                Your global settings are not modified.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Override and continue
          </button>
        </div>
      </div>
    </div>
  );
}
