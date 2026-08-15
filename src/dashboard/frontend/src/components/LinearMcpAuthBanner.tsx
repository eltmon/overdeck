import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useLinearMcpAuthStatus } from '../hooks/useLinearMcpAuthStatus';
import { trackerIssueUrl } from '../lib/issueLinks';

/**
 * Global intervention banner for Linear MCP OAuth (PAN-2997). Any agent whose
 * Linear MCP session expired emits a structured event; the server folds those
 * into one intervention and this banner is the operator's single place to act
 * on it — instead of the authorization URL being buried in one agent's
 * transcript.
 */
export function LinearMcpAuthBanner() {
  const { data: intervention } = useLinearMcpAuthStatus();
  const [callbackUrl, setCallbackUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);

  if (!intervention || intervention.status === 'none') return null;

  const blockedAgents = intervention.blockedAgents ?? [];

  const handleCallbackSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/linear-mcp-auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to relay callback URL (${res.status})`);
      }
      toast.success(`Callback URL relayed to ${body.relayedTo ?? 'the blocked agent'} — it will finish the OAuth flow.`);
      setCallbackUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to relay callback URL');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkCompleted = async () => {
    setCompleting(true);
    try {
      const res = await fetch('/api/linear-mcp-auth/complete', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to mark Linear auth completed (${res.status})`);
      }
      toast.success('Marked Linear authentication healthy — blocked agents are being woken to re-check.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark Linear auth completed');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
        <p className="text-warning-foreground text-sm font-semibold flex-1">
          Linear authentication required — {blockedAgents.length} agent{blockedAgents.length === 1 ? '' : 's'} blocked on Linear MCP OAuth.
        </p>
        {intervention.authUrl && intervention.status === 'active' && (
          <a
            href={intervention.authUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors shrink-0 flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Linear authorization{intervention.authUrlAgentId ? ` (from ${intervention.authUrlAgentId})` : ''}
          </a>
        )}
        <button
          onClick={handleMarkCompleted}
          disabled={completing}
          className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
        >
          {completing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Marking…
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mark completed
            </>
          )}
        </button>
      </div>

      {blockedAgents.length > 0 && (
        <ul className="text-warning-foreground text-sm pl-8 flex flex-col gap-0.5">
          {blockedAgents.map((agent) => {
            const issueUrl = agent.issueUrl ?? (agent.issueId ? trackerIssueUrl(agent.issueId) : null);
            // Conversations link to their canonical /conv/<rowid> view (the
            // DB row id, projected by the server); agents without a
            // conversation page stay plain text next to their issue link.
            return (
              <li key={agent.agentId}>
                {agent.conversationUrl ? (
                  <a href={agent.conversationUrl} className="font-semibold underline hover:opacity-80">
                    {agent.agentId}
                  </a>
                ) : (
                  <span className="font-semibold">{agent.agentId}</span>
                )}
                {agent.issueId && (
                  <>
                    {' — '}
                    {issueUrl ? (
                      <a href={issueUrl} target="_blank" rel="noreferrer" className="underline hover:opacity-80">
                        {agent.issueId}
                      </a>
                    ) : (
                      agent.issueId
                    )}
                  </>
                )}
                {agent.notifiedAt && <span className="opacity-80"> (woken, re-checking)</span>}
              </li>
            );
          })}
        </ul>
      )}

      {intervention.status === 'expired' ? (
        <p className="text-warning-foreground text-sm pl-8 opacity-80">
          This authorization link expired — it refreshes automatically when a blocked agent generates a fresh one.
        </p>
      ) : !intervention.authUrl ? (
        <p className="text-warning-foreground text-sm pl-8 opacity-80">
          Waiting for a blocked agent to produce an authorization URL — it appears here as soon as one does.
        </p>
      ) : null}

      <div className="flex items-center gap-2 pl-8">
        <input
          type="text"
          value={callbackUrl}
          onChange={(event) => setCallbackUrl(event.target.value)}
          placeholder="Paste the localhost callback URL here"
          className="flex-1 max-w-xl px-2 py-1.5 text-sm rounded-md bg-background border border-warning/40 text-foreground placeholder:text-muted-foreground"
        />
        <button
          onClick={handleCallbackSubmit}
          disabled={submitting || callbackUrl.trim() === ''}
          className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {submitting ? 'Relaying…' : 'Submit callback URL'}
        </button>
      </div>
      <p className="text-warning-foreground text-xs pl-8 opacity-80">
        After authorizing in your browser, Linear redirects to a localhost URL. On a remote session the callback page
        fails to load — copy the URL from the address bar and paste it above; it is relayed to the blocked agent to
        finish the flow. If you authorized another way (e.g. <code>claude mcp login linear</code>), use Mark completed:
        blocked agents will be woken to re-check Linear access, and this banner returns if authentication is still broken.
      </p>
    </div>
  );
}
