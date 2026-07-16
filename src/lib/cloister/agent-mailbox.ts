/**
 * Issue-role mailbox stored directly in human-readable `.pan/feedback/*.md` files.
 * The YAML frontmatter is the mailbox envelope; the markdown body remains the message.
 */

import { readFile, readdir, rename, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getReadableWorkspacePanPaths, getWorkspacePanPaths } from '../pan-dir/index.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { readMailboxActionStatus, type MailboxActionStatus } from './mailbox-status-source.js';

export type MailboxRole = 'work';
export type MailboxState = 'pending' | 'delivered' | 'acknowledged';

export interface MailboxMetadata {
  issueId: string;
  role: MailboxRole;
  source: string;
  summary: string;
  actionRequired: boolean;
  state: MailboxState;
  createdAt: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  filePath: string;
}

export interface MailboxItem extends MailboxMetadata {
  legacy: boolean;
  markdownBody: string;
}

export interface MailboxAddress {
  issueId: string;
  role: MailboxRole;
  workspacePath?: string;
}

export interface CreateMailboxItemOptions extends MailboxAddress {
  source: string;
  summary: string;
  actionRequired: boolean;
  filePath: string;
  markdownBody: string;
  createdAt?: string;
}

export interface MailboxTransitionOptions extends MailboxAddress {
  filePath: string;
  at?: string;
}

export interface PreparedWorkMailbox {
  message: string;
  items: MailboxItem[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const NUMBERED_FEEDBACK = /^\d{3}-(.+)\.md$/;
const transitionQueues = new Map<string, Promise<void>>();
const mailboxReadCache = new Map<string, {
  mtimeMs: number;
  size: number;
  content: string;
  parsed: ReturnType<typeof parseMailboxMarkdown>;
}>();
const mailboxDirectoryCache = new Map<string, { mtimeMs: number; filenames: string[] }>();
const MAILBOX_READ_CACHE_MAX_ENTRIES = 512;
const MAILBOX_DIRECTORY_CACHE_MAX_ENTRIES = 128;
const MAILBOX_FILE_READ_CONCURRENCY = 8;
const MAILBOX_CONFIRM_CONCURRENCY = 4;

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
}

export function getMailboxCacheSizesForTests(): { files: number; directories: number } {
  return { files: mailboxReadCache.size, directories: mailboxDirectoryCache.size };
}

export function resetMailboxCachesForTests(): void {
  mailboxReadCache.clear();
  mailboxDirectoryCache.clear();
}

export function hasActionableMailboxItems(items: Pick<MailboxItem, 'state' | 'actionRequired'>[]): boolean {
  return items.some(item => item.state === 'pending' || (item.state === 'delivered' && item.actionRequired));
}

interface MailboxFeedbackFile {
  filename: string;
  path: string;
  content: string;
  parsed: ReturnType<typeof parseMailboxMarkdown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMailboxState(value: unknown): value is MailboxState {
  return value === 'pending' || value === 'delivered' || value === 'acknowledged';
}

function parseMetadata(value: unknown): MailboxMetadata | null {
  if (!isRecord(value)) return null;
  const mailbox = isRecord(value.mailbox) ? value.mailbox : null;
  if (!mailbox) return null;
  if (
    typeof mailbox.issueId !== 'string' || mailbox.role !== 'work' ||
    typeof mailbox.source !== 'string' || typeof mailbox.summary !== 'string' ||
    typeof mailbox.actionRequired !== 'boolean' || !isMailboxState(mailbox.state) ||
    typeof mailbox.createdAt !== 'string' || typeof mailbox.filePath !== 'string'
  ) return null;
  if (mailbox.deliveredAt !== undefined && typeof mailbox.deliveredAt !== 'string') return null;
  if (mailbox.acknowledgedAt !== undefined && typeof mailbox.acknowledgedAt !== 'string') return null;
  return mailbox as unknown as MailboxMetadata;
}

export function parseMailboxMarkdown(content: string): { metadata: MailboxMetadata | null; markdownBody: string } {
  const match = content.match(FRONTMATTER);
  if (!match) return { metadata: null, markdownBody: content };
  try {
    return { metadata: parseMetadata(parseYaml(match[1])), markdownBody: match[2] };
  } catch {
    return { metadata: null, markdownBody: content };
  }
}

export function renderMailboxMarkdown(metadata: MailboxMetadata, markdownBody: string): string {
  const yaml = stringifyYaml({ mailbox: metadata }, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${markdownBody.replace(/^\s+/, '')}`;
}

export function createMailboxItem(options: CreateMailboxItemOptions): MailboxItem {
  return {
    issueId: options.issueId.toUpperCase(),
    role: options.role,
    source: options.source,
    summary: options.summary,
    actionRequired: options.actionRequired,
    state: 'pending',
    createdAt: options.createdAt ?? new Date().toISOString(),
    filePath: options.filePath,
    legacy: false,
    markdownBody: options.markdownBody,
  };
}

export function renderMailboxItem(item: MailboxItem): string {
  const { legacy: _legacy, markdownBody, ...metadata } = item;
  return renderMailboxMarkdown(metadata, markdownBody);
}

function resolveWorkspacePath(options: MailboxAddress): string | null {
  if (options.workspacePath) return options.workspacePath;
  const resolved = resolveProjectFromIssueSync(options.issueId);
  return resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${options.issueId.toLowerCase()}`)
    : null;
}

function legacySource(filename: string): string {
  const stem = filename.match(NUMBERED_FEEDBACK)?.[1] ?? filename;
  return stem.replace(/-(?:failed|changes-requested|blocked|error)$/, '');
}

function legacySummary(filename: string, body: string): string {
  const firstMeaningful = body.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return firstMeaningful?.replace(/^#+\s*/, '').slice(0, 160) || filename;
}

function legacyRequiresAction(source: string, status: MailboxActionStatus | null): boolean {
  if (!status) return false;
  if (source.includes('review')) return status.reviewStatus === 'blocked' || status.reviewStatus === 'failed';
  if (source.includes('test') || source.includes('uat')) return status.testStatus === 'failed' || status.testStatus === 'dispatch_failed';
  if (source.includes('verification') || source.includes('ci')) return status.verificationStatus === 'failed';
  return false;
}

async function readMailboxFeedback(workspacePath: string): Promise<MailboxFeedbackFile[]> {
  const feedbackDir = getReadableWorkspacePanPaths(workspacePath).feedbackDir;
  let filenames: string[];
  try {
    const directoryStat = await stat(feedbackDir);
    const cachedDirectory = mailboxDirectoryCache.get(feedbackDir);
    if (cachedDirectory?.mtimeMs === directoryStat.mtimeMs) {
      filenames = cachedDirectory.filenames;
      setBoundedCache(mailboxDirectoryCache, feedbackDir, cachedDirectory, MAILBOX_DIRECTORY_CACHE_MAX_ENTRIES);
    } else {
      filenames = (await readdir(feedbackDir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && NUMBERED_FEEDBACK.test(entry.name))
        .map(entry => entry.name)
        .sort();
      setBoundedCache(
        mailboxDirectoryCache,
        feedbackDir,
        { mtimeMs: directoryStat.mtimeMs, filenames },
        MAILBOX_DIRECTORY_CACHE_MAX_ENTRIES,
      );
    }
  } catch {
    mailboxDirectoryCache.delete(feedbackDir);
    return [];
  }

  const livePaths = new Set(filenames.map(filename => join(feedbackDir, filename)));
  for (const path of mailboxReadCache.keys()) {
    if (path.startsWith(`${feedbackDir}/`) && !livePaths.has(path)) mailboxReadCache.delete(path);
  }

  const indexedResults = filenames.map(filename => {
    const path = join(feedbackDir, filename);
    const cached = mailboxReadCache.get(path);
    if (!cached) return null;
    setBoundedCache(mailboxReadCache, path, cached, MAILBOX_READ_CACHE_MAX_ENTRIES);
    return { filename, path, content: cached.content, parsed: cached.parsed };
  });
  if (indexedResults.every((result): result is MailboxFeedbackFile => result !== null)) {
    return indexedResults;
  }

  const results = new Array<MailboxFeedbackFile>(filenames.length);
  let nextIndex = 0;
  async function readNext(): Promise<void> {
    while (nextIndex < filenames.length) {
      const index = nextIndex++;
      const filename = filenames[index];
      const path = join(feedbackDir, filename);
      const fileStat = await stat(path);
      let cached = mailboxReadCache.get(path);
      if (!cached || cached.mtimeMs !== fileStat.mtimeMs || cached.size !== fileStat.size) {
        const content = await readFile(path, 'utf8');
        cached = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, content, parsed: parseMailboxMarkdown(content) };
        setBoundedCache(mailboxReadCache, path, cached, MAILBOX_READ_CACHE_MAX_ENTRIES);
      } else {
        setBoundedCache(mailboxReadCache, path, cached, MAILBOX_READ_CACHE_MAX_ENTRIES);
      }
      results[index] = { filename, path, content: cached.content, parsed: cached.parsed };
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(MAILBOX_FILE_READ_CONCURRENCY, filenames.length) },
    () => readNext(),
  ));
  return results;
}

export async function listMailboxItems(options: MailboxAddress): Promise<MailboxItem[]> {
  const workspacePath = resolveWorkspacePath(options);
  if (!workspacePath) return [];
  const files = await readMailboxFeedback(workspacePath);
  let legacyStatus: MailboxActionStatus | null | undefined;
  const items: MailboxItem[] = [];

  for (const file of files) {
    const parsed = file.parsed;
    if (parsed.metadata) {
      if (parsed.metadata.issueId.toUpperCase() !== options.issueId.toUpperCase() || parsed.metadata.role !== options.role) continue;
      items.push({ ...parsed.metadata, filePath: file.path, legacy: false, markdownBody: parsed.markdownBody });
      continue;
    }

    if (options.role !== 'work') continue;
    legacyStatus ??= readMailboxActionStatus(options.issueId);
    const source = legacySource(file.filename);
    if (!legacyRequiresAction(source, legacyStatus)) continue;
    items.push({
      issueId: options.issueId.toUpperCase(), role: options.role, source,
      summary: legacySummary(file.filename, file.content), actionRequired: true,
      state: 'pending', createdAt: new Date(0).toISOString(), filePath: file.path,
      legacy: true, markdownBody: file.content,
    });
  }
  return items;
}

async function transitionMailboxItem(
  options: MailboxTransitionOptions,
  target: 'delivered' | 'acknowledged',
): Promise<MailboxItem> {
  const workspacePath = isAbsolute(options.filePath) ? null : resolveWorkspacePath(options);
  if (!isAbsolute(options.filePath) && !workspacePath) throw new Error(`Workspace not found for ${options.issueId}`);
  const absolutePath = isAbsolute(options.filePath)
    ? options.filePath
    : join(getWorkspacePanPaths(workspacePath!).feedbackDir, options.filePath);
  const previous = transitionQueues.get(absolutePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  transitionQueues.set(absolutePath, queued);
  await previous;
  try {
  const content = await readFile(absolutePath, 'utf8');
  const parsed = parseMailboxMarkdown(content);
  if (!parsed.metadata) throw new Error(`Feedback file has no mailbox metadata: ${absolutePath}`);
  if (parsed.metadata.issueId.toUpperCase() !== options.issueId.toUpperCase() || parsed.metadata.role !== options.role) {
    throw new Error(`Mailbox item is not addressed to ${options.issueId}/${options.role}: ${absolutePath}`);
  }
  const at = options.at ?? new Date().toISOString();
  const metadata = { ...parsed.metadata };
  if (target === 'delivered' && metadata.state === 'pending') {
    metadata.state = 'delivered';
    metadata.deliveredAt = at;
  } else if (target === 'acknowledged' && metadata.state === 'delivered') {
    metadata.state = 'acknowledged';
    metadata.acknowledgedAt = at;
  }
  const item = { ...metadata, legacy: false, markdownBody: parsed.markdownBody } satisfies MailboxItem;
  const rendered = renderMailboxItem(item);
  if (rendered !== content) {
    const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, rendered, 'utf8');
    await rename(temporaryPath, absolutePath);
    mailboxReadCache.delete(absolutePath);
    mailboxDirectoryCache.delete(dirname(absolutePath));
  }
  return item;
  } finally {
    release();
    if (transitionQueues.get(absolutePath) === queued) transitionQueues.delete(absolutePath);
  }
}

export function markMailboxItemDelivered(options: MailboxTransitionOptions): Promise<MailboxItem> {
  return transitionMailboxItem(options, 'delivered');
}

export function markMailboxItemAcknowledged(options: MailboxTransitionOptions): Promise<MailboxItem> {
  return transitionMailboxItem(options, 'acknowledged');
}

/** Render the deterministic pull section without advancing durable mailbox state. */
export async function prepareWorkMailbox(
  message: string,
  options: Omit<MailboxAddress, 'role'>,
): Promise<PreparedWorkMailbox> {
  const address = { ...options, role: 'work' as const };
  const items = (await listMailboxItems(address)).filter(item =>
    item.state === 'pending' || (item.state === 'delivered' && item.actionRequired));
  if (items.length === 0) return { message, items: [] };

  const lines = [
    '## Pending issue mailbox',
    '',
    'Read every feedback file listed below before continuing with normal work.',
  ];
  for (const item of items) {
    lines.push('', `- ${item.source}: ${item.summary}`, `  File: ${item.filePath}`);
  }

  return { message: `${lines.join('\n')}\n\n---\n\n${message}`, items };
}

/** Advance only mailbox items whose rendered message reached the agent. */
export async function confirmWorkMailboxDelivery(items: MailboxItem[]): Promise<void> {
  const transitionable = items.filter(item => !item.legacy);
  let nextIndex = 0;
  async function confirmNext(): Promise<void> {
    while (nextIndex < transitionable.length) {
      const item = transitionable[nextIndex++];
      const transition = { issueId: item.issueId, role: item.role, filePath: item.filePath };
      if (item.state === 'pending') await markMailboxItemDelivered(transition);
      else if (item.state === 'delivered') await markMailboxItemAcknowledged(transition);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(MAILBOX_CONFIRM_CONCURRENCY, transitionable.length) },
    () => confirmNext(),
  ));
}

/** Preserve successful prompt transport when mailbox accounting cannot be persisted. */
export async function confirmWorkMailboxDeliveryBestEffort(
  items: MailboxItem[],
  context: string,
  confirm: (items: MailboxItem[]) => Promise<void> = confirmWorkMailboxDelivery,
): Promise<void> {
  try {
    await confirm(items);
  } catch (error) {
    console.warn(`[${context}] Mailbox delivery confirmation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Build the pull section without claiming that transport has succeeded. */
export async function drainWorkMailbox(options: Omit<MailboxAddress, 'role'>): Promise<string> {
  const prepared = await prepareWorkMailbox('', options);
  return prepared.items.length > 0 ? prepared.message.replace(/\n\n---\n\n$/, '') : '';
}

export async function prependWorkMailbox(
  message: string,
  options: Omit<MailboxAddress, 'role'>,
): Promise<string> {
  return (await prepareWorkMailbox(message, options)).message;
}
