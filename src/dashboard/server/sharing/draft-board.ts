/**
 * The host's prompt drafts for one share (PRD PAN-4476 WI-3, FR-2).
 *
 * One draft per author, last write wins; an empty text deletes it. Each change is relayed through
 * `onRelay` at most once per DRAFT_RELAY_MS per author: a change relays at once when the author's last
 * relay was at least DRAFT_RELAY_MS ago, otherwise one trailing relay sends the latest text when the
 * window ends. `remove` and `take` relay the deletion at once. Times are the host clock, never the
 * viewer's. Nothing is persisted (D-15) and nothing here logs draft text (NFR-5).
 */
import {
  SHARED_PROMPT_MAX_CHARS,
  type DraftPayload,
  type ShareDraftView,
  type ShareIdentity,
} from '@overdeck/contracts';

export const DRAFT_RELAY_MS = 200;

export interface DraftBoardDeps {
  now(): number;
  onRelay(payload: DraftPayload): void;
}

interface Draft {
  readonly author: ShareIdentity;
  readonly text: string;
  readonly startedAt: number;
  readonly updatedAt: number;
}

interface RelayState {
  login: string;
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class DraftBoard {
  private readonly drafts = new Map<number, Draft>();
  private readonly relays = new Map<number, RelayState>();
  private closed = false;

  constructor(private readonly deps: DraftBoardDeps) {}

  /** Records the author's whole draft. Ignores text over SHARED_PROMPT_MAX_CHARS; '' deletes. */
  update(author: ShareIdentity, text: string): void {
    if (this.closed || text.length > SHARED_PROMPT_MAX_CHARS) return;
    const existing = this.drafts.get(author.githubId);
    if (text === '') {
      if (!existing) return;
      this.drafts.delete(author.githubId);
    } else {
      if (existing && existing.text === text) return;
      const now = this.deps.now();
      this.drafts.set(author.githubId, { author, text, startedAt: existing?.startedAt ?? now, updatedAt: now });
    }
    this.scheduleRelay(author.githubId, author.login);
  }

  /** Deletes the author's draft and relays the deletion at once. */
  remove(githubId: number): void {
    this.take(githubId);
  }

  /** Deletes the author's draft, relays the deletion at once and returns what was there. */
  take(githubId: number): ShareDraftView | null {
    if (this.closed) return null;
    const draft = this.drafts.get(githubId);
    const relay = this.relays.get(githubId);
    if (!draft && relay?.timer == null) return null;
    this.drafts.delete(githubId);
    this.relayNow(githubId, draft?.author.login ?? relay?.login ?? '');
    return draft ? viewOf(draft) : null;
  }

  /** The current drafts, oldest started first. */
  list(): ShareDraftView[] {
    return this.ordered().map(viewOf);
  }

  /** The current drafts as host → viewer payloads, oldest started first. */
  payloads(): DraftPayload[] {
    return this.ordered().map((draft) => ({
      authorGithubId: draft.author.githubId,
      authorLogin: draft.author.login,
      text: draft.text,
      updatedAt: draft.updatedAt,
    }));
  }

  close(): void {
    this.closed = true;
    for (const relay of this.relays.values()) if (relay.timer) clearTimeout(relay.timer);
    this.relays.clear();
    this.drafts.clear();
  }

  private ordered(): Draft[] {
    return [...this.drafts.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  private scheduleRelay(githubId: number, login: string): void {
    const relay = this.relays.get(githubId);
    if (relay) relay.login = login;
    const now = this.deps.now();
    if (!relay || now - relay.lastAt >= DRAFT_RELAY_MS) {
      this.relayNow(githubId, login);
      return;
    }
    if (relay.timer) return;
    relay.timer = setTimeout(() => {
      relay.timer = null;
      this.relayNow(githubId, relay.login);
    }, relay.lastAt + DRAFT_RELAY_MS - now);
  }

  private relayNow(githubId: number, login: string): void {
    if (this.closed) return;
    const relay = this.relays.get(githubId);
    if (relay?.timer) clearTimeout(relay.timer);
    const now = this.deps.now();
    this.relays.set(githubId, { login, lastAt: now, timer: null });
    const draft = this.drafts.get(githubId);
    this.deps.onRelay(
      draft
        ? { authorGithubId: githubId, authorLogin: draft.author.login, text: draft.text, updatedAt: draft.updatedAt }
        : { authorGithubId: githubId, authorLogin: login, text: '', updatedAt: now },
    );
  }
}

function viewOf(draft: Draft): ShareDraftView {
  return {
    githubId: draft.author.githubId,
    login: draft.author.login,
    avatarUrl: draft.author.avatarUrl,
    text: draft.text,
    startedAt: new Date(draft.startedAt).toISOString(),
    updatedAt: new Date(draft.updatedAt).toISOString(),
  };
}
