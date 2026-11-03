import { AlertTriangle, ExternalLink, KeyRound } from 'lucide-react';

import { useConversationSearchStatus } from '../hooks/useConversationSearchStatus';
import { requestSettingsSection } from '../lib/settingsSection';

interface ConversationSearchBannerProps {
  /** Switches the app to the Settings tab; the banner deep-links into it. */
  onOpenSettings?: () => void;
}

const actionClass =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/50';

/**
 * Shown when conversation search is enabled but cannot actually serve queries —
 * config-level unavailability (missing API key) or runtime embed failures
 * (exhausted credits, quota, network). PAN-3771: these used to be silent,
 * indistinguishable from "no results".
 */
export function ConversationSearchBanner({ onOpenSettings }: ConversationSearchBannerProps = {}) {
  const { data: status } = useConversationSearchStatus();

  if (!status?.enabled) return null;

  const health = status.health;
  const recentlyFailing =
    health?.lastErrorAt != null &&
    (health.lastSuccessAt == null || health.lastErrorAt > health.lastSuccessAt);
  // PAN-3915: a dead transcript watcher is shown only while it is waiting to
  // restart, or for good once restarts stopped; once re-armed, its last error
  // is history, not current state.
  const watcherState = health?.watcher?.state;
  const watcherDown = watcherState === 'restarting' || watcherState === 'failed';
  if (status.available && !recentlyFailing && !watcherDown) return null;

  const watcherOnly = status.available && !recentlyFailing;
  const watcherFailed = watcherOnly && watcherState === 'failed';
  const watcherReason = health?.watcher?.lastErrorReason ?? 'unknown error';
  const reason = !status.available
    ? status.unavailableReason ?? 'embedding provider unavailable'
    : watcherFailed
      ? `transcript watcher stopped after repeated failures (${watcherReason})`
      : watcherOnly
        ? `transcript watcher failed (${watcherReason}), restarting`
        : health?.lastErrorReason ?? 'recent embedding failures';
  const creditRelated = /credit|billing|quota|insufficient/i.test(reason);
  const missingKey = !status.available && /api key not found/i.test(reason);

  const title = missingKey
    ? 'Conversation search needs an OpenAI API key'
    : watcherOnly
      ? 'Transcript indexing is paused'
      : 'Conversation search is not working';

  const openKeySettings = () => {
    requestSettingsSection('provider-openai');
    onOpenSettings?.();
  };

  const suffix = watcherFailed
    ? '— new transcripts are not indexed. Restart the dashboard or save the conversation-search settings to retry.'
    : watcherOnly
      ? '— new transcripts are not indexed until the watcher is back.'
      : '— Ctrl+K conversation hits and transcript indexing are unavailable until this is fixed.';
  const detail = missingKey
    ? "Ctrl+K can't find past conversations, and new transcripts aren't indexed. Setting OPENAI_API_KEY on the server works too."
    : `${reason} ${suffix}`;

  // One slim line in the system-notices row (PAN-2908), so it sits beside
  // other notices instead of stacking a two-line block above the page.
  return (
    <div
      role="status"
      className="flex min-w-0 flex-1 items-center gap-2 bg-warning/10 px-4 py-1"
      data-testid="conversation-search-banner"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-xs text-warning-foreground" title={`${title}. ${detail}`}>
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{' · '}</span>
        {missingKey ? (
          <span className="text-muted-foreground">
            Ctrl+K can&apos;t find past conversations, and new transcripts aren&apos;t indexed. Setting{' '}
            <code className="font-mono text-[11px] text-foreground">OPENAI_API_KEY</code>{' '}
            on the server works too.
          </span>
        ) : (
          <span className="text-muted-foreground">
            <span>{reason}</span>{' '}
            <span>{suffix}</span>
          </span>
        )}
      </p>
      {missingKey && (
        <button type="button" onClick={openKeySettings} className={actionClass}>
          <KeyRound className="size-3.5 text-warning-foreground" aria-hidden="true" />
          Add OpenAI key
        </button>
      )}
      {creditRelated && (
        <a
          href="https://platform.openai.com/settings/organization/billing/"
          target="_blank"
          rel="noreferrer"
          className={actionClass}
        >
          <ExternalLink className="size-3.5 text-warning-foreground" aria-hidden="true" />
          OpenAI billing
        </a>
      )}
    </div>
  );
}
