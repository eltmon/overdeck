/**
 * cliproxy-pool.ts
 *
 * Reads the CLIProxy account pool through CLIProxy's localhost management API
 * (PAN-5278). `listPoolAccounts()` lists the auth files (`GET auth-files`).
 * `readPool()` also reads each enabled `codex` and `claude` account's usage
 * windows: CLIProxy's `POST api-call` sends the provider's usage request with
 * the account's own token, which CLIProxy substitutes for `$TOKEN$`.
 * `setAccountPriority()` sets one account's routing priority with
 * `PATCH auth-files/fields` (verified to persist on CLIProxy 8.0.71; see the
 * PAN-5278 PRD "Checkpoint result").
 *
 * No-secrets rule: nothing this module returns, throws or logs contains the
 * management key, an account token, or upstream response text. Errors are
 * short fixed strings such as `HTTP 429 from provider`.
 *
 * Every request has a 15-second timeout (AbortController + setTimeout, so
 * Vitest fake timers drive it). A failed usage read marks only that account.
 *
 * Leaf module: it imports only `./cliproxy.js` and built-ins.
 */

import { CLIPROXY_BASE_URL, CliproxyError, readManagementKey } from './cliproxy.js';

export type PoolProvider = 'codex' | 'claude' | string;

export interface PoolWindow {
  /** 'weekly' | '5-hour' | 'primary' | 'secondary' — label for display. */
  label: string;
  usedPercent: number;
  /** ISO time, or null when the provider gave none. */
  resetsAt: string | null;
  windowSeconds: number | null;
}

export interface PoolAccount {
  /** Auth file name, used for PATCH. */
  name: string;
  authIndex: string;
  provider: PoolProvider;
  email: string | null;
  plan: string | null;
  disabled: boolean;
  priority: number | null;
  windows: PoolWindow[];
  weeklyResetsAt: string | null;
  exhausted: boolean;
  /** Short reason when usage could not be read; never contains upstream body text. */
  error: string | null;
  /** False for providers whose usage is not read (gemini, …) and for disabled accounts. */
  usageRead: boolean;
}

export interface PoolSnapshot {
  checkedAt: string;
  managementAvailable: boolean;
  accounts: PoolAccount[];
}

export interface PoolAccountList {
  managementAvailable: boolean;
  accounts: PoolAccount[];
}

export const POOL_REQUEST_TIMEOUT_MS = 15_000;
const USAGE_READ_CONCURRENCY = 4;

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_USAGE_USER_AGENT = 'claude-code/2.1.273';

const WEEKLY_MIN_SECONDS = 6 * 86_400;
const FIVE_HOUR_MAX_SECONDS = 6 * 3_600;

function managementUrl(path: string): string {
  return `${CLIPROXY_BASE_URL}/v0/management/${path}`;
}

/** fetch with a 15-second abort. Resolves null on a network error or timeout. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POOL_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An auth-files row plus the fields only the usage request needs. */
interface ListedAccount {
  account: PoolAccount;
  chatgptAccountId: string | null;
}

function decodeAuthFile(row: unknown): ListedAccount | null {
  if (!isRecord(row)) return null;
  const name = stringOrNull(row.name) ?? stringOrNull(row.id);
  const authIndex = stringOrNull(row.auth_index);
  const provider = stringOrNull(row.provider) ?? stringOrNull(row.type);
  if (!name || !authIndex || !provider) return null;

  // CLIProxy 7.x rows carried an `id_token` object; 8.0.71 rows do not.
  const idToken = isRecord(row.id_token) ? row.id_token : {};
  const plan = stringOrNull(idToken.plan_type) ?? stringOrNull(idToken.chatgpt_plan_type);
  return {
    account: {
      name,
      authIndex,
      provider,
      email: stringOrNull(row.email),
      plan,
      disabled: row.disabled === true,
      priority: Number.isInteger(row.priority) ? row.priority as number : null,
      windows: [],
      weeklyResetsAt: null,
      exhausted: false,
      error: null,
      usageRead: false,
    },
    chatgptAccountId: stringOrNull(idToken.chatgpt_account_id) ?? stringOrNull(row.account_id),
  };
}

async function listAccounts(managementKey: string): Promise<ListedAccount[] | null> {
  const response = await fetchWithTimeout(managementUrl('auth-files'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!response || !response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(body) || !Array.isArray(body.files)) return null;
  return body.files
    .map(decodeAuthFile)
    .filter((entry): entry is ListedAccount => entry !== null);
}

function usageReadable(account: PoolAccount): boolean {
  return !account.disabled && (account.provider === 'codex' || account.provider === 'claude');
}

/**
 * List the pool's accounts from the local management API only (no upstream
 * usage reads). `managementAvailable` is false when the key is missing or the
 * management API does not answer.
 */
export async function listPoolAccounts(): Promise<PoolAccountList> {
  const managementKey = await readManagementKey();
  if (!managementKey) return { managementAvailable: false, accounts: [] };
  const listed = await listAccounts(managementKey);
  if (!listed) return { managementAvailable: false, accounts: [] };
  return { managementAvailable: true, accounts: listed.map((entry) => entry.account) };
}

function usageRequest(entry: ListedAccount): { url: string; header: Record<string, string> } {
  if (entry.account.provider === 'codex') {
    const header: Record<string, string> = {
      Authorization: 'Bearer $TOKEN$',
      'OpenAI-Beta': 'codex-1',
      Originator: 'Codex Desktop',
    };
    if (entry.chatgptAccountId) header['Chatgpt-Account-Id'] = entry.chatgptAccountId;
    return { url: CODEX_USAGE_URL, header };
  }
  return {
    url: CLAUDE_USAGE_URL,
    header: {
      Authorization: 'Bearer $TOKEN$',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': CLAUDE_USAGE_USER_AGENT,
    },
  };
}

interface UsageResult {
  windows: PoolWindow[];
  weeklyResetsAt: string | null;
  exhausted: boolean;
  plan: string | null;
}

function codexWindow(raw: unknown, slot: 'primary' | 'secondary'): PoolWindow | null {
  if (!isRecord(raw)) return null;
  const usedPercent = numberOrNull(raw.used_percent);
  if (usedPercent === null) return null;
  const windowSeconds = numberOrNull(raw.limit_window_seconds);
  const resetAt = numberOrNull(raw.reset_at);
  let label: string = slot;
  if (windowSeconds !== null && windowSeconds >= WEEKLY_MIN_SECONDS) label = 'weekly';
  else if (windowSeconds !== null && windowSeconds <= FIVE_HOUR_MAX_SECONDS) label = '5-hour';
  return {
    label,
    usedPercent,
    resetsAt: resetAt === null ? null : new Date(resetAt * 1000).toISOString(),
    windowSeconds,
  };
}

function parseCodexUsage(body: unknown): UsageResult | null {
  if (!isRecord(body)) return null;
  const rateLimit = isRecord(body.rate_limit) ? body.rate_limit : {};
  const windows = [
    codexWindow(rateLimit.primary_window, 'primary'),
    codexWindow(rateLimit.secondary_window, 'secondary'),
  ].filter((window): window is PoolWindow => window !== null);

  let weekly: PoolWindow | null = null;
  for (const window of windows) {
    if (window.windowSeconds === null) continue;
    if (!weekly || window.windowSeconds > (weekly.windowSeconds ?? 0)) weekly = window;
  }

  const exhausted = rateLimit.limit_reached === true
    || rateLimit.allowed === false
    || windows.some((window) => window.usedPercent >= 100);
  return {
    windows,
    weeklyResetsAt: weekly?.resetsAt ?? null,
    exhausted,
    plan: stringOrNull(body.plan_type),
  };
}

function claudeWindow(raw: unknown, label: string, windowSeconds: number): PoolWindow | null {
  if (!isRecord(raw)) return null;
  const usedPercent = numberOrNull(raw.utilization);
  if (usedPercent === null) return null;
  return { label, usedPercent, resetsAt: stringOrNull(raw.resets_at), windowSeconds };
}

function parseClaudeUsage(body: unknown): UsageResult | null {
  if (!isRecord(body)) return null;
  const fiveHour = claudeWindow(body.five_hour, '5-hour', 5 * 3_600);
  const sevenDay = claudeWindow(body.seven_day, 'weekly', 7 * 86_400);
  const windows = [fiveHour, sevenDay].filter((window): window is PoolWindow => window !== null);
  return {
    windows,
    weeklyResetsAt: sevenDay?.resetsAt ?? null,
    exhausted: windows.some((window) => window.usedPercent >= 100),
    plan: 'Claude subscription',
  };
}

async function readUsage(managementKey: string, entry: ListedAccount): Promise<PoolAccount> {
  const account: PoolAccount = { ...entry.account, usageRead: true };
  const { url, header } = usageRequest(entry);
  const response = await fetchWithTimeout(managementUrl('api-call'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_index: entry.account.authIndex, method: 'GET', url, header }),
  });
  if (!response) return { ...account, error: 'usage request failed or timed out' };
  if (!response.ok) return { ...account, error: `HTTP ${response.status} from management API` };

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    return { ...account, error: 'unreadable usage response' };
  }
  if (!isRecord(envelope)) return { ...account, error: 'unreadable usage response' };
  const statusCode = numberOrNull(envelope.status_code);
  if (statusCode === null) return { ...account, error: 'unreadable usage response' };
  if (statusCode < 200 || statusCode > 299) {
    return { ...account, error: `HTTP ${statusCode} from provider` };
  }

  let body: unknown;
  try {
    body = typeof envelope.body === 'string' ? JSON.parse(envelope.body) : envelope.body;
  } catch {
    return { ...account, error: 'unreadable usage response' };
  }
  const usage = account.provider === 'codex' ? parseCodexUsage(body) : parseClaudeUsage(body);
  if (!usage) return { ...account, error: 'unreadable usage response' };
  return {
    ...account,
    windows: usage.windows,
    weeklyResetsAt: usage.weeklyResetsAt,
    exhausted: usage.exhausted,
    plan: usage.plan ?? account.plan,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Read the whole pool: every account, plus usage windows for enabled `codex`
 * and `claude` accounts (at most 4 usage reads at once).
 */
export async function readPool(): Promise<PoolSnapshot> {
  const checkedAt = new Date().toISOString();
  const managementKey = await readManagementKey();
  if (!managementKey) return { checkedAt, managementAvailable: false, accounts: [] };
  const listed = await listAccounts(managementKey);
  if (!listed) return { checkedAt, managementAvailable: false, accounts: [] };

  const accounts = await mapWithConcurrency(listed, USAGE_READ_CONCURRENCY, (entry) =>
    usageReadable(entry.account) ? readUsage(managementKey, entry) : Promise.resolve(entry.account),
  );
  return { checkedAt, managementAvailable: true, accounts };
}

/** Set one account's routing priority. Throws CliproxyError on any failure. */
export async function setAccountPriority(name: string, priority: number): Promise<void> {
  const managementKey = await readManagementKey();
  if (!managementKey) {
    throw new CliproxyError({
      operation: 'set-priority',
      message: 'CLIProxy management key is not configured',
    });
  }
  const response = await fetchWithTimeout(managementUrl('auth-files/fields'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${managementKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, priority }),
  });
  if (!response) {
    throw new CliproxyError({
      operation: 'set-priority',
      message: `setting priority on ${name} failed or timed out`,
    });
  }
  if (!response.ok) {
    throw new CliproxyError({
      operation: 'set-priority',
      message: `setting priority on ${name} returned HTTP ${response.status}`,
    });
  }
}
