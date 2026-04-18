/**
 * CacheService — Two-layer cache for dashboard API responses
 *
 * L1: In-memory Map (hot, 10s TTL, 50 entries max)
 * L2: SQLite (persistent, survives restarts)
 *
 * Stores API responses per tracker with ETag support (GitHub REST 304s are FREE).
 * Tracks rate limits per tracker for adaptive backoff.
 */

import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';

declare const Bun: unknown;
const _require = createRequire(import.meta.url);

function openSqliteDb(dbPath: string): Database.Database {
  if (typeof Bun !== 'undefined') {
    const { Database: BunDatabase } = _require('bun:sqlite') as { Database: new (path: string) => any };
    const bunDb = new BunDatabase(dbPath);
    bunDb.pragma = function (sql: string, options?: { simple?: boolean }): any {
      if (options?.simple) {
        const key = sql.trim();
        const row = bunDb.query(`PRAGMA ${key}`).get() as Record<string, unknown> | null;
        return row?.[key] ?? null;
      }
      bunDb.exec(`PRAGMA ${sql}`);
      return undefined;
    };
    return bunDb as Database.Database;
  }
  const BetterSqlite3 = _require('better-sqlite3');
  return new BetterSqlite3(dbPath) as Database.Database;
}

const PANOPTICON_HOME = process.env.PANOPTICON_HOME || join(homedir(), '.panopticon');
const CACHE_DB_PATH = join(PANOPTICON_HOME, 'cache.db');

// Default TTLs per tracker (seconds)
export const DEFAULT_TTLS: Record<string, number> = {
  github: 60,
  linear: 30,
  rally: 120,
};

// L1 in-memory cache entry
interface L1Entry {
  data: any;
  etag?: string;
  lastModified?: string;
  lastFetchedAt: string;
  lastUpdatedAt: string;
  ttlSeconds: number;
  insertedAt: number; // Date.now()
}

// Rate limit info
export interface RateLimitInfo {
  remaining: number;
  total: number;
  resetAt: string;
}

// Cache entry returned from get()
export interface CacheEntry {
  data: any;
  etag?: string;
  lastModified?: string;
  lastFetchedAt: string;
  lastUpdatedAt: string;
  ttlSeconds: number;
}

export class CacheService {
  private db: Database.Database;
  private l1: Map<string, L1Entry> = new Map();
  private readonly l1MaxEntries = 50;
  private readonly l1TtlMs = 10_000; // 10 seconds

  constructor() {
    if (!existsSync(PANOPTICON_HOME)) {
      mkdirSync(PANOPTICON_HOME, { recursive: true });
    }
    this.db = openSqliteDb(CACHE_DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        tracker TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        data TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        last_fetched_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        ttl_seconds INTEGER NOT NULL,
        PRIMARY KEY (tracker, cache_key)
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        tracker TEXT PRIMARY KEY,
        remaining INTEGER,
        total INTEGER,
        reset_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Get a cached entry. Checks L1 first, then L2 (SQLite).
   * Returns null if no entry or if expired.
   */
  get(tracker: string, cacheKey: string): CacheEntry | null {
    const compositeKey = `${tracker}:${cacheKey}`;

    // L1 check
    const l1Entry = this.l1.get(compositeKey);
    if (l1Entry && Date.now() - l1Entry.insertedAt < this.l1TtlMs) {
      return {
        data: l1Entry.data,
        etag: l1Entry.etag,
        lastModified: l1Entry.lastModified,
        lastFetchedAt: l1Entry.lastFetchedAt,
        lastUpdatedAt: l1Entry.lastUpdatedAt,
        ttlSeconds: l1Entry.ttlSeconds,
      };
    }

    // L1 miss or expired — check L2
    const stmt = this.db.prepare(`
      SELECT data, etag, last_modified, last_fetched_at, last_updated_at, ttl_seconds
      FROM api_cache
      WHERE tracker = ? AND cache_key = ?
    `);

    const row = stmt.get(tracker, cacheKey) as any;
    if (!row) return null;

    const entry: CacheEntry = {
      data: JSON.parse(row.data),
      etag: row.etag || undefined,
      lastModified: row.last_modified || undefined,
      lastFetchedAt: row.last_fetched_at,
      lastUpdatedAt: row.last_updated_at,
      ttlSeconds: row.ttl_seconds,
    };

    // Promote to L1
    this.setL1(compositeKey, {
      ...entry,
      insertedAt: Date.now(),
    });

    return entry;
  }

  /**
   * Get cached entry even if stale (for serving while re-fetching).
   */
  getStale(tracker: string, cacheKey: string): CacheEntry | null {
    const compositeKey = `${tracker}:${cacheKey}`;

    // Check L1 (even if expired)
    const l1Entry = this.l1.get(compositeKey);
    if (l1Entry) {
      return {
        data: l1Entry.data,
        etag: l1Entry.etag,
        lastModified: l1Entry.lastModified,
        lastFetchedAt: l1Entry.lastFetchedAt,
        lastUpdatedAt: l1Entry.lastUpdatedAt,
        ttlSeconds: l1Entry.ttlSeconds,
      };
    }

    // L2
    const stmt = this.db.prepare(`
      SELECT data, etag, last_modified, last_fetched_at, last_updated_at, ttl_seconds
      FROM api_cache
      WHERE tracker = ? AND cache_key = ?
    `);

    const row = stmt.get(tracker, cacheKey) as any;
    if (!row) return null;

    return {
      data: JSON.parse(row.data),
      etag: row.etag || undefined,
      lastModified: row.last_modified || undefined,
      lastFetchedAt: row.last_fetched_at,
      lastUpdatedAt: row.last_updated_at,
      ttlSeconds: row.ttl_seconds,
    };
  }

  /**
   * Store data in both L1 and L2 cache.
   */
  set(
    tracker: string,
    cacheKey: string,
    data: any,
    options?: {
      etag?: string;
      lastModified?: string;
      lastUpdatedAt?: string;
      ttlSeconds?: number;
    }
  ): void {
    const now = new Date().toISOString();
    const ttl = options?.ttlSeconds ?? DEFAULT_TTLS[tracker] ?? 60;
    const lastUpdatedAt = options?.lastUpdatedAt ?? now;
    const compositeKey = `${tracker}:${cacheKey}`;

    // L2 (SQLite) — upsert
    const stmt = this.db.prepare(`
      INSERT INTO api_cache (tracker, cache_key, data, etag, last_modified, last_fetched_at, last_updated_at, ttl_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tracker, cache_key) DO UPDATE SET
        data = excluded.data,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        last_fetched_at = excluded.last_fetched_at,
        last_updated_at = excluded.last_updated_at,
        ttl_seconds = excluded.ttl_seconds
    `);

    stmt.run(
      tracker,
      cacheKey,
      JSON.stringify(data),
      options?.etag ?? null,
      options?.lastModified ?? null,
      now,
      lastUpdatedAt,
      ttl
    );

    // L1
    this.setL1(compositeKey, {
      data,
      etag: options?.etag,
      lastModified: options?.lastModified,
      lastFetchedAt: now,
      lastUpdatedAt,
      ttlSeconds: ttl,
      insertedAt: Date.now(),
    });
  }

  /**
   * Check if a cache entry is stale (past its TTL).
   */
  isStale(tracker: string, cacheKey: string): boolean {
    const entry = this.get(tracker, cacheKey);
    if (!entry) return true;

    const fetchedAt = new Date(entry.lastFetchedAt).getTime();
    const age = (Date.now() - fetchedAt) / 1000;
    return age > entry.ttlSeconds;
  }

  /**
   * Get the stored ETag for a tracker/key combo (for conditional requests).
   */
  getEtag(tracker: string, cacheKey: string): string | undefined {
    // Check L1 first
    const compositeKey = `${tracker}:${cacheKey}`;
    const l1Entry = this.l1.get(compositeKey);
    if (l1Entry?.etag) return l1Entry.etag;

    // Check L2
    const stmt = this.db.prepare(`
      SELECT etag FROM api_cache WHERE tracker = ? AND cache_key = ?
    `);
    const row = stmt.get(tracker, cacheKey) as any;
    return row?.etag || undefined;
  }

  /**
   * Invalidate cache for a specific tracker (all keys).
   */
  invalidate(tracker: string): void {
    // L1 — remove all entries for this tracker
    for (const key of this.l1.keys()) {
      if (key.startsWith(`${tracker}:`)) {
        this.l1.delete(key);
      }
    }

    // L2
    this.db.prepare('DELETE FROM api_cache WHERE tracker = ?').run(tracker);
  }

  /**
   * Invalidate a specific cache key.
   */
  invalidateKey(tracker: string, cacheKey: string): void {
    this.l1.delete(`${tracker}:${cacheKey}`);
    this.db.prepare('DELETE FROM api_cache WHERE tracker = ? AND cache_key = ?').run(tracker, cacheKey);
  }

  // --- Rate limit tracking ---

  /**
   * Update rate limit info for a tracker.
   */
  updateRateLimit(tracker: string, info: RateLimitInfo): void {
    const stmt = this.db.prepare(`
      INSERT INTO rate_limits (tracker, remaining, total, reset_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tracker) DO UPDATE SET
        remaining = excluded.remaining,
        total = excluded.total,
        reset_at = excluded.reset_at,
        updated_at = excluded.updated_at
    `);
    stmt.run(tracker, info.remaining, info.total, info.resetAt, new Date().toISOString());
  }

  /**
   * Get rate limit info for a tracker.
   */
  getRateLimit(tracker: string): RateLimitInfo | null {
    const stmt = this.db.prepare(`
      SELECT remaining, total, reset_at FROM rate_limits WHERE tracker = ?
    `);
    const row = stmt.get(tracker) as any;
    if (!row) return null;

    return {
      remaining: row.remaining,
      total: row.total,
      resetAt: row.reset_at,
    };
  }

  /**
   * Check if we should back off requests for a tracker.
   * Returns true if remaining < 10% of total.
   */
  shouldBackoff(tracker: string): boolean {
    const limit = this.getRateLimit(tracker);
    if (!limit) return false;

    // If reset time has passed, no need to back off
    if (new Date(limit.resetAt).getTime() < Date.now()) return false;

    return limit.remaining < limit.total * 0.1;
  }

  /**
   * Calculate adaptive backoff delay in ms.
   * Returns 0 if no backoff needed.
   */
  getBackoffMs(tracker: string, baseIntervalMs: number): number {
    const limit = this.getRateLimit(tracker);
    if (!limit) return 0;

    // If reset time has passed, no backoff
    if (new Date(limit.resetAt).getTime() < Date.now()) return 0;

    const ratioRemaining = limit.remaining / limit.total;

    if (ratioRemaining > 0.5) return 0;             // >50% remaining: no backoff
    if (ratioRemaining > 0.25) return baseIntervalMs; // 25-50%: 2x interval
    if (ratioRemaining > 0.1) return baseIntervalMs * 4; // 10-25%: 5x interval
    return baseIntervalMs * 9;                        // <10%: 10x interval
  }

  /**
   * Get cache status for all trackers (for diagnostics endpoint).
   */
  getStatus(): Record<string, {
    remaining: number | null;
    total: number | null;
    lastFetched: string | null;
    cacheKeys: number;
  }> {
    const result: Record<string, any> = {};

    for (const tracker of ['github', 'linear', 'rally']) {
      const limit = this.getRateLimit(tracker);
      const countStmt = this.db.prepare(
        'SELECT COUNT(*) as cnt, MAX(last_fetched_at) as latest FROM api_cache WHERE tracker = ?'
      );
      const row = countStmt.get(tracker) as any;

      result[tracker] = {
        remaining: limit?.remaining ?? null,
        total: limit?.total ?? null,
        lastFetched: row?.latest ?? null,
        cacheKeys: row?.cnt ?? 0,
      };
    }

    return result;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.l1.clear();
    this.db.close();
  }

  // --- L1 helpers ---

  private setL1(compositeKey: string, entry: L1Entry): void {
    // Evict oldest if at capacity
    if (this.l1.size >= this.l1MaxEntries && !this.l1.has(compositeKey)) {
      const oldestKey = this.l1.keys().next().value;
      if (oldestKey) this.l1.delete(oldestKey);
    }
    this.l1.set(compositeKey, entry);
  }
}
