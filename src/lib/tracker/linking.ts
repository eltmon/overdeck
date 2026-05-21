/**
 * Cross-Tracker Linking
 *
 * Manages links between issues in different trackers.
 * Links are stored in a local JSON file for persistence.
 *
 * This module owns a per-process singleton (via `getLinkManager`) backed by
 * a sync JSON file on disk. The persistence helpers are exposed as Effects
 * so callers can compose them into typed pipelines without losing the
 * convenient in-memory cache semantics.
 */

import { Effect } from 'effect';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { TrackerType } from './interface.js';
import { FsError } from '../errors.js';

// Link direction types
export type LinkDirection = 'blocks' | 'blocked_by' | 'related' | 'duplicate_of';

// A single link between two issues
export interface TrackerLink {
  sourceIssueRef: string;    // e.g., "MIN-630"
  sourceTracker: TrackerType;
  targetIssueRef: string;    // e.g., "#42"
  targetTracker: TrackerType;
  direction: LinkDirection;
  createdAt: string;         // ISO timestamp
}

// Storage format
interface LinkStore {
  version: 1;
  links: TrackerLink[];
}

const DEFAULT_STORE: LinkStore = { version: 1, links: [] };

/**
 * Parse an issue reference to extract tracker and ID.
 * Examples:
 *   "#42" -> { tracker: "github", ref: "#42" }
 *   "github#42" -> { tracker: "github", ref: "#42" }
 *   "MIN-630" -> { tracker: "linear", ref: "MIN-630" }
 *   "gitlab#15" -> { tracker: "gitlab", ref: "#15" }
 */
export function parseIssueRef(
  ref: string,
): { tracker: TrackerType; ref: string } | null {
  if (ref.startsWith('github#')) {
    return { tracker: 'github', ref: `#${ref.slice(7)}` };
  }
  if (ref.startsWith('gitlab#')) {
    return { tracker: 'gitlab', ref: `#${ref.slice(7)}` };
  }
  if (ref.startsWith('linear:')) {
    return { tracker: 'linear', ref: ref.slice(7) };
  }

  if (/^#\d+$/.test(ref)) {
    return { tracker: 'github', ref };
  }

  if (/^[A-Z]+-\d+$/i.test(ref)) {
    return { tracker: 'linear', ref: ref.toUpperCase() };
  }

  return null;
}

/**
 * Format an issue ref with tracker prefix for display.
 */
export function formatIssueRef(ref: string, tracker: TrackerType): string {
  if (tracker === 'github') {
    return ref.startsWith('#') ? `github${ref}` : `github#${ref}`;
  }
  if (tracker === 'gitlab') {
    return ref.startsWith('#') ? `gitlab${ref}` : `gitlab#${ref}`;
  }
  return ref; // Linear refs are already unique
}

const pathExists = (path: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: () => undefined,
  }).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

/**
 * Link Manager for cross-tracker issue linking.
 *
 * The cache is lazily hydrated; persistence operations return Effects that
 * surface typed `FsError`s on filesystem failures.
 */
export class LinkManager {
  private storePath: string;
  private store: LinkStore = { version: 1, links: [] };
  private loaded = false;

  constructor(storePath?: string) {
    this.storePath = storePath ?? join(homedir(), '.panopticon', 'links.json');
  }

  /**
   * Hydrate the in-memory store from disk. Safe to call multiple times.
   */
  load(): Effect.Effect<void, FsError> {
    const self = this;
    if (self.loaded) return Effect.succeed(undefined);

    return pathExists(self.storePath).pipe(
      Effect.flatMap((exists) => {
        if (!exists) {
          self.store = { ...DEFAULT_STORE };
          self.loaded = true;
          return Effect.succeed(undefined);
        }

        return Effect.tryPromise({
          try: () => readFile(self.storePath, 'utf-8'),
          catch: (cause) =>
            new FsError({ path: self.storePath, operation: 'readFile', cause }),
        }).pipe(
          Effect.map((raw) => {
            try {
              const data = JSON.parse(raw);
              self.store = data.version === 1 ? data : { ...DEFAULT_STORE };
            } catch {
              self.store = { ...DEFAULT_STORE };
            }
            self.loaded = true;
          }),
        );
      }),
    );
  }

  /** Persist current in-memory store to disk. */
  save(): Effect.Effect<void, FsError> {
    const self = this;
    const dir = join(self.storePath, '..');

    return Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: (cause) =>
        new FsError({ path: dir, operation: 'mkdir', cause }),
    }).pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            writeFile(
              self.storePath,
              JSON.stringify(self.store, null, 2),
              'utf-8',
            ),
          catch: (cause) =>
            new FsError({
              path: self.storePath,
              operation: 'writeFile',
              cause,
            }),
        }),
      ),
    );
  }

  /** Add a link between two issues. */
  addLink(
    source: { ref: string; tracker: TrackerType },
    target: { ref: string; tracker: TrackerType },
    direction: LinkDirection = 'related',
  ): Effect.Effect<TrackerLink, FsError> {
    const self = this;
    return self.load().pipe(
      Effect.flatMap(() => {
        const existing = self.store.links.find(
          (l) =>
            l.sourceIssueRef === source.ref &&
            l.sourceTracker === source.tracker &&
            l.targetIssueRef === target.ref &&
            l.targetTracker === target.tracker,
        );

        if (existing) {
          if (existing.direction !== direction) {
            existing.direction = direction;
            return self.save().pipe(Effect.map(() => existing));
          }
          return Effect.succeed(existing);
        }

        const link: TrackerLink = {
          sourceIssueRef: source.ref,
          sourceTracker: source.tracker,
          targetIssueRef: target.ref,
          targetTracker: target.tracker,
          direction,
          createdAt: new Date().toISOString(),
        };
        self.store.links.push(link);
        return self.save().pipe(Effect.map(() => link));
      }),
    );
  }

  /** Remove a link between two issues. Returns true if a link was removed. */
  removeLink(
    source: { ref: string; tracker: TrackerType },
    target: { ref: string; tracker: TrackerType },
  ): Effect.Effect<boolean, FsError> {
    const self = this;
    return self.load().pipe(
      Effect.flatMap(() => {
        const index = self.store.links.findIndex(
          (l) =>
            l.sourceIssueRef === source.ref &&
            l.sourceTracker === source.tracker &&
            l.targetIssueRef === target.ref &&
            l.targetTracker === target.tracker,
        );

        if (index >= 0) {
          self.store.links.splice(index, 1);
          return self.save().pipe(Effect.map(() => true));
        }
        return Effect.succeed(false);
      }),
    );
  }

  /** Get all issues linked to a given issue. */
  getLinkedIssues(
    ref: string,
    tracker: TrackerType,
  ): Effect.Effect<TrackerLink[], FsError> {
    const self = this;
    return self.load().pipe(
      Effect.map(() =>
        self.store.links.filter(
          (l) =>
            (l.sourceIssueRef === ref && l.sourceTracker === tracker) ||
            (l.targetIssueRef === ref && l.targetTracker === tracker),
        ),
      ),
    );
  }

  /** Get all links (for debugging/admin). */
  getAllLinks(): Effect.Effect<TrackerLink[], FsError> {
    const self = this;
    return self.load().pipe(Effect.map(() => [...self.store.links]));
  }

  /** Find linked issue in another tracker. */
  findLinkedIssue(
    ref: string,
    sourceTracker: TrackerType,
    targetTracker: TrackerType,
  ): Effect.Effect<string | null, FsError> {
    const self = this;
    return self.load().pipe(
      Effect.map(() => {
        const asSource = self.store.links.find(
          (l) =>
            l.sourceIssueRef === ref &&
            l.sourceTracker === sourceTracker &&
            l.targetTracker === targetTracker,
        );
        if (asSource) return asSource.targetIssueRef;

        const asTarget = self.store.links.find(
          (l) =>
            l.targetIssueRef === ref &&
            l.targetTracker === sourceTracker &&
            l.sourceTracker === targetTracker,
        );
        if (asTarget) return asTarget.sourceIssueRef;
        return null;
      }),
    );
  }

  /** Clear all links (for testing). */
  clear(): Effect.Effect<void, FsError> {
    const self = this;
    return self.load().pipe(
      Effect.flatMap(() => {
        self.store.links = [];
        return self.save();
      }),
    );
  }
}

// Singleton instance
let _linkManager: LinkManager | null = null;

export function getLinkManager(): LinkManager {
  if (!_linkManager) {
    _linkManager = new LinkManager();
  }
  return _linkManager;
}
