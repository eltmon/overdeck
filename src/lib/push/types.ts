/**
 * PAN-2354: shared types for needs-you push. Types only — no runtime imports.
 * PAN-2080 adds Slack, email and TTS providers against `PushProvider`.
 */
import type { PhoneNotificationCategory } from '@overdeck/contracts';

export type NeedsYouKind = 'question' | 'approval' | 'finished' | 'failed' | 'summary' | 'test';

/** What a phone's notification-type switches act on (PAN-5019 D-2); independent of `kind`. */
export type NeedsYouCategory = PhoneNotificationCategory | 'summary' | 'test';

export interface NeedsYouNotification {
  kind: NeedsYouKind;
  /** What a phone's notification-type switches act on (PAN-5019 D-2). */
  category: NeedsYouCategory;
  /** Stable dedup and replace key, e.g. `auq:toolu_01…`. */
  tag: string;
  /** Web Push title (may name the conversation). */
  title: string;
  /** Third-party-safe title: kind plus issue id or "a conversation" only (D-8). */
  publicTitle: string;
  body: string;
  /** Same-origin path, e.g. `/m?subject=my-conv`. */
  url: string;
  issueId: string | null;
  ts: string;
}

export type ProviderSendOutcome =
  | { target: string; ok: true }
  | {
      target: string;
      ok: false;
      reason: 'gone' | 'rejected' | 'transient' | 'revoked' | 'skipped';
      status?: number;
      detail?: string;
    };

export interface PushProvider {
  readonly name: 'webpush' | 'ntfy' | (string & {});
  /** True when this provider has at least one target right now. */
  hasTargets(): Promise<boolean>;
  send(notification: NeedsYouNotification): Promise<ProviderSendOutcome[]>;
}

/** PAN-5111: one provider target's result, as stored. Never carries provider detail text (D-4). */
export interface PushDelivery {
  provider: string;
  target: string;
  ok: boolean;
  /** A ProviderSendOutcome reason code, or 'error' for a rejected provider. */
  reason?: string;
  status?: number;
}

/** PAN-5111: one delivered push as written to `push-sent.jsonl`. Holds `title`, never `body` (D-4). */
export interface PushSentRecord {
  id: string;
  ts: string;
  kind: NeedsYouKind;
  category: NeedsYouCategory;
  /** The notification tag: `auq:…`, `plan:…`, `perm:…`, `journal:…`, `dead:…`, `summary`, `test`. */
  key: string;
  /** `agent:<id>` or `conv:<name>`; null for edge, summary and test pushes. */
  subject: string | null;
  title: string;
  issueId: string | null;
  url: string;
  deliveries: PushDelivery[];
}

export type PushResolutionOutcome = 'answered' | 'resolved-without-answer';

export interface PushResolutionRecord {
  id: string;
  ts: string;
  outcome: PushResolutionOutcome;
}

/** PAN-5111: what the dispatcher writes to and adopts from. */
export interface PushHistorySink {
  recordSent(record: PushSentRecord): void;
  recordResolution(record: PushResolutionRecord): void;
  /** D-8: newest unresolved entry id for `key` (and `subject` for non-`auq:`/`plan:` keys); memory only. */
  openEntryIdFor(subject: string, key: string): { id: string; ts: string } | null;
}
