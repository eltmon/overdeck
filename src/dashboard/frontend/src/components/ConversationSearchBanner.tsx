import { AlertTriangle, ExternalLink } from 'lucide-react';

import { useConversationSearchStatus } from '../hooks/useConversationSearchStatus';

/**
 * Shown when conversation search is enabled but cannot actually serve queries —
 * config-level unavailability (missing API key) or runtime embed failures
 * (exhausted credits, quota, network). PAN-3771: these used to be silent,
 * indistinguishable from "no results".
 */
export function ConversationSearchBanner() {
  const { data: status } = useConversationSearchStatus();

  if (!status?.enabled) return null;

  const health = status.health;
  const recentlyFailing =
    health?.lastErrorAt != null &&
    (health.lastSuccessAt == null || health.lastErrorAt > health.lastSuccessAt);
  if (status.available && !recentlyFailing) return null;

  const reason = status.available
    ? health?.lastErrorReason ?? 'recent embedding failures'
    : status.unavailableReason ?? 'embedding provider unavailable';
  const creditRelated = /credit|billing|quota|insufficient/i.test(reason);

  return (
    <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex items-center gap-3 shrink-0">
      <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
      <p className="text-warning-foreground text-sm font-semibold flex-1">
        Conversation search is not working: <span className="font-normal">{reason}</span>
        <span className="font-normal ml-1 opacity-80">
          — Ctrl+K conversation hits and transcript indexing are unavailable until this is fixed.
        </span>
      </p>
      {creditRelated && (
        <a
          href="https://platform.openai.com/settings/organization/billing/"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors shrink-0 flex items-center gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          OpenAI billing
        </a>
      )}
    </div>
  );
}
