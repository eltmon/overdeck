/**
 * Who Overdeck is on GitHub (#4066 review, R3-2): the identities it posts
 * verdicts as, and the account type of a comment's or review's author.
 *
 * The App's bot is matched as a GitHub `Bot` account with the App's own slug,
 * and the `gh` user as a `User`, never by login alone: `gh pr view` reports
 * only a login, and strips a bot's `[bot]` suffix, so a User account named
 * after the App's slug would otherwise pass as the bot. `pr-facts` applies
 * these rules to verdict markers and reviews.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A comment's or review's author. `__typename` is GitHub's GraphQL account
 * type (`Bot` for an App's bot, `User` for a person); `gh pr view` reports
 * only the login, and strips a bot's `[bot]` suffix, so the type is read
 * separately ({@link ReadAuthorKinds}).
 */
export interface ForgeAuthor {
  login?: string | null;
  __typename?: string | null;
}

/**
 * The identities Overdeck posts as, by account type: `users` are people's
 * logins, `bots` the App's slug. Both lower-cased, without `[bot]`.
 */
export interface TrustedAuthors {
  users: ReadonlySet<string>;
  bots: ReadonlySet<string>;
}

export const NO_TRUSTED_AUTHORS: TrustedAuthors = { users: new Set(), bots: new Set() };

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/, '');
}

/** `<slug>[bot]` names the App's bot; any other login a person. */
export function trustedAuthorsFrom(logins: readonly string[]): TrustedAuthors {
  const users = new Set<string>();
  const bots = new Set<string>();
  for (const login of logins) {
    if (/\[bot\]$/i.test(login.trim())) bots.add(normalizeLogin(login));
    else users.add(normalizeLogin(login));
  }
  return { users, bots };
}

/**
 * #4066 review (R3-2): whether an author is one of Overdeck's identities. The
 * login alone never decides: a User account can be named after the App's
 * slug, and `gh` reports the bot without its `[bot]` suffix. A bot entry
 * matches only an author GitHub types `Bot`, a person's only one typed
 * `User`; an author whose type is unknown matches nothing.
 */
export function isOverdeckIdentity(author: ForgeAuthor | null | undefined, trusted: TrustedAuthors): boolean {
  const login = author?.login;
  if (!login) return false;
  if (author.__typename === 'Bot') return trusted.bots.has(normalizeLogin(login));
  if (author.__typename === 'User') return trusted.users.has(normalizeLogin(login));
  return false;
}

/**
 * The logins Overdeck posts verdicts as: the authenticated `gh` user and, when
 * the GitHub App is configured, its bot (`<slug>[bot]`, resolved from the App,
 * never assumed: #4066 review, R3-2). Resolved once per process; an answer
 * missing either (gh unreachable, the App's slug unreadable) is not cached,
 * so the next read tries again.
 */
let overdeckLoginsPromise: Promise<{ logins: readonly string[]; complete: boolean }> | null = null;

async function readOverdeckLogins(): Promise<{ logins: readonly string[]; complete: boolean }> {
  const logins: string[] = [];
  let complete = true;
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf-8', timeout: 15_000,
    });
    if (stdout.trim()) logins.push(stdout.trim());
  } catch {
    // Not authenticated as a user (or offline): association alone decides.
    complete = false;
  }
  try {
    const { resolveAppBotLogin } = await import('../github-app.js');
    const bot = await resolveAppBotLogin();
    if (bot) logins.push(bot);
  } catch {
    // The App is configured but its bot login is unknown: trust no bot.
    complete = false;
  }
  return { logins, complete };
}

export async function defaultOverdeckLogins(): Promise<readonly string[]> {
  overdeckLoginsPromise ??= readOverdeckLogins();
  const { logins, complete } = await overdeckLoginsPromise;
  if (!complete) overdeckLoginsPromise = null;
  return logins;
}

/** The App's bot login; null without the App, a throw when its slug is unknown. */
export async function defaultAppBotLogin(): Promise<string | null> {
  const { resolveAppBotLogin } = await import('../github-app.js');
  return resolveAppBotLogin();
}

/**
 * #4066 review (R3-2): the account type of each comment or review author, by
 * node id, from GitHub's GraphQL API. `gh pr view` reports only a login.
 */
export type ReadAuthorKinds = (nodeIds: readonly string[]) => Promise<ReadonlyMap<string, ForgeAuthor>>;

const AUTHOR_KINDS_QUERY = 'query($ids:[ID!]!){nodes(ids:$ids){'
  + '... on IssueComment{id author{__typename login}} '
  + '... on PullRequestReview{id author{__typename login}}}}';

export async function defaultReadAuthorKinds(nodeIds: readonly string[]): Promise<ReadonlyMap<string, ForgeAuthor>> {
  const kinds = new Map<string, ForgeAuthor>();
  for (let start = 0; start < nodeIds.length; start += 100) {
    const ids = nodeIds.slice(start, start + 100);
    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'graphql', '-f', `query=${AUTHOR_KINDS_QUERY}`, ...ids.flatMap((id) => ['-f', `ids[]=${id}`])],
      { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const nodes = (JSON.parse(stdout) as { data?: { nodes?: Array<{ id?: string; author?: ForgeAuthor | null } | null> } })
      .data?.nodes ?? [];
    for (const node of nodes) {
      if (node?.id && node.author) kinds.set(node.id, { login: node.author.login, __typename: node.author.__typename });
    }
  }
  return kinds;
}

/**
 * #4066 review (R3-2): type the authors `needsKind` picks, by node id. Only
 * a typed author whose login is the one `gh` reported is taken. A failed read
 * leaves the authors untyped, and an untyped author is no Overdeck identity.
 */
export async function withAuthorKinds<T extends { id?: string | null; author?: ForgeAuthor | null }>(
  items: readonly T[],
  needsKind: (item: T) => boolean,
  readAuthorKinds: ReadAuthorKinds,
): Promise<T[]> {
  const ids = [...new Set(items
    .filter((item) => item.id && !item.author?.__typename && needsKind(item))
    .map((item) => item.id!))];
  if (ids.length === 0) return [...items];
  let kinds: ReadonlyMap<string, ForgeAuthor>;
  try {
    kinds = await readAuthorKinds(ids);
  } catch {
    return [...items];
  }
  return items.map((item) => {
    const kind = item.id ? kinds.get(item.id) : undefined;
    const reported = item.author?.login;
    if (!kind?.__typename || !kind.login || !reported || normalizeLogin(kind.login) !== normalizeLogin(reported)) return item;
    return { ...item, author: { ...item.author, __typename: kind.__typename } };
  });
}
