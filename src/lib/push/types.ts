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
