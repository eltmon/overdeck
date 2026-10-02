import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ExternalLink, CheckCircle2, Link2 } from 'lucide-react';
import type { LinearMcpAuthBlockedAgent } from '../hooks/useLinearMcpAuthStatus';
import { useLinearConnectFlow, type LinearConnectPhase } from '../hooks/useLinearConnectFlow';
import { trackerIssueUrl } from '../lib/issueLinks';
import { isLoopbackHost } from '../lib/loopbackHost';

/**
 * A blocked agent's row label and in-dashboard link (PAN-4464): the
 * conversation title linking its /conv/<rowid> view, else the issue id
 * linking the issue view, else the raw agent id as plain text.
 */
export function blockedAgentLink(agent: LinearMcpAuthBlockedAgent): { label: string; href: string | null } {
  const label = agent.conversationTitle ?? agent.issueId ?? agent.agentId;
  const href = agent.conversationUrl ?? (agent.issueId ? `/issues/${agent.issueId}` : null);
  return { label, href };
}

/**
 * Global intervention banner for Linear MCP OAuth (PAN-2997). Any agent whose
 * Linear MCP session expired emits a structured event; the server folds those
 * into one intervention and this banner is the operator's single place to act
 * on it — instead of the authorization URL being buried in one agent's
 * transcript.
 *
 * The primary action is Connect Linear (PAN-4464): it opens the usable link
 * or gets a fresh one, and on a same-machine dashboard closes the flow when
 * the operator returns. Pasting the callback URL is the fallback for a
 * browser on another device, so it lives in a disclosure that starts open
 * only on a non-loopback host.
 */
export function LinearMcpAuthBanner() {
  const flow = useLinearConnectFlow();
  const intervention = flow.intervention;
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

  const buttonClass = 'px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5';

  return (
    <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
        <p className="text-warning-foreground text-sm font-semibold flex-1">
          Linear authentication required — {blockedAgents.length} agent{blockedAgents.length === 1 ? '' : 's'} blocked on Linear MCP OAuth.
        </p>
        {flow.fallbackUrl ? (
          <a href={flow.fallbackUrl} target="_blank" rel="noreferrer" className={buttonClass}>
            <ExternalLink className="w-3.5 h-3.5" />
            Open Linear authorization
          </a>
        ) : (
          <button onClick={flow.connect} disabled={flow.phase !== 'idle'} className={buttonClass}>
            <Link2 className="w-3.5 h-3.5" />
            Connect Linear
          </button>
        )}
      </div>

      <ConnectStatusLine
        phase={flow.phase}
        expired={intervention.status === 'expired'}
        notice={flow.notice}
        onCheckNow={flow.checkNow}
      />

      {blockedAgents.length > 0 && (
        <ul className="text-warning-foreground text-sm pl-8 flex flex-col gap-0.5">
          {blockedAgents.map((agent) => {
            const { label, href } = blockedAgentLink(agent);
            const issueUrl = agent.issueUrl ?? (agent.issueId ? trackerIssueUrl(agent.issueId) : null);
            return (
              <li key={agent.agentId}>
                {href ? (
                  <a href={href} title={agent.agentId} className="font-semibold underline hover:opacity-80">
                    {label}
                  </a>
                ) : (
                  <span className="font-semibold" title={agent.agentId}>{label}</span>
                )}
                {agent.issueId && issueUrl && (
                  <a
                    href={issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${agent.issueId} in tracker`}
                    className="inline-flex align-middle ml-1 hover:opacity-80"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {agent.notifiedAt && <span className="opacity-80"> (woken, re-checking)</span>}
              </li>
            );
          })}
        </ul>
      )}

      <details
        open={!isLoopbackHost(window.location.hostname)}
        className="pl-8 text-warning-foreground text-sm"
      >
        <summary className="cursor-pointer opacity-80 hover:opacity-100">
          Signed in from a different device? Paste the callback URL
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex items-center gap-2">
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
          <p className="text-xs opacity-80">
            After authorizing in your browser, Linear redirects to a localhost URL. On a remote session the callback page
            fails to load — copy the URL from the address bar and paste it above; it is relayed to the blocked agent to
            finish the flow. If you authorized another way (e.g. <code>claude mcp login linear</code>), use Mark completed:
            blocked agents will be woken to re-check Linear access, and this banner returns if authentication is still broken.
          </p>
          <div>
            <button onClick={handleMarkCompleted} disabled={completing} className={buttonClass}>
              {completing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Marking…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Already authorized another way? Mark completed
                </>
              )}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function ConnectStatusLine({ phase, expired, notice, onCheckNow }: {
  phase: LinearConnectPhase;
  expired: boolean;
  notice: string | null;
  onCheckNow: () => void;
}) {
  let copy: string | null = null;
  if (phase === 'opening') copy = 'Opening Linear…';
  else if (phase === 'refreshing') copy = 'Getting a fresh link…';
  else if (phase === 'awaiting-approval') copy = 'Approve access in the Linear tab, then come back here.';
  else if (phase === 'checking') copy = 'Checking Linear access…';
  else if (expired) copy = 'The last authorization link expired — Connect Linear gets a fresh one.';

  if (copy === null && notice === null) return null;
  const spinning = phase === 'opening' || phase === 'refreshing' || phase === 'checking';

  return (
    <div className="text-warning-foreground text-sm pl-8 flex flex-col gap-1">
      {copy !== null && (
        <div className="flex items-center gap-2">
          {spinning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span className="opacity-80">{copy}</span>
          {phase === 'awaiting-approval' && (
            <button onClick={onCheckNow} className="underline font-semibold hover:opacity-80">
              Check now
            </button>
          )}
        </div>
      )}
      {notice !== null && <p className="opacity-80">{notice}</p>}
    </div>
  );
}
