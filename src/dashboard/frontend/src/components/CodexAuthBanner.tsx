import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { SensitiveText } from './SensitiveText';
import { useCodexAuthStatus } from '../hooks/useCodexAuthStatus';
import { setReauthSessionName } from '../lib/pending-codex-spawn';

export function CodexAuthBanner() {
  const { data: authStatus } = useCodexAuthStatus();
  const [spawning, setSpawning] = useState(false);

  if (!authStatus) return null;
  if (authStatus.status !== 'expired' && authStatus.status !== 'burned') {
    return null;
  }

  const handleReauth = async () => {
    setSpawning(true);
    try {
      const res = await fetch('/api/settings/codex-reauth', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to spawn re-auth session (${res.status})`);
      }
      const { sessionName, token } = await res.json() as { sessionName: string; token: string };
      setReauthSessionName(sessionName);
      toast.success('Re-authentication session started — opening terminal…');
      window.location.href = `/terminal/${sessionName}?token=${encodeURIComponent(token)}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start re-authentication');
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex items-center gap-3 shrink-0">
      <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
      <p className="text-warning-foreground text-sm font-semibold flex-1">
        Codex authentication {authStatus.status} — gpt-5.4 agents will fail.
        {authStatus.email && (
          <span className="font-normal ml-1 opacity-80">(<SensitiveText value={authStatus.email} className="text-sm" />)</span>
        )}
      </p>
      <button
        onClick={handleReauth}
        disabled={spawning}
        className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
      >
        {spawning ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <ExternalLink className="w-3.5 h-3.5" />
            Re-authenticate
          </>
        )}
      </button>
    </div>
  );
}
