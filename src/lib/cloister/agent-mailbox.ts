/**
 * Issue-role mailbox stored directly in human-readable `.pan/feedback/*.md` files.
 * The YAML frontmatter is the mailbox envelope; the markdown body remains the message.
 */

import { readFile, writeFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getWorkspacePanPaths, readFeedback } from '../pan-dir/index.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { Effect } from 'effect';

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

interface LegacyActionStatus {
  reviewStatus?: string;
  testStatus?: string;
  verificationStatus?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const NUMBERED_FEEDBACK = /^\d{3}-(.+)\.md$/;

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

function legacyRequiresAction(source: string, status: LegacyActionStatus | null): boolean {
  if (!status) return false;
  if (source.includes('review')) return status.reviewStatus === 'blocked' || status.reviewStatus === 'failed';
  if (source.includes('test') || source.includes('uat')) return status.testStatus === 'failed' || status.testStatus === 'dispatch_failed';
  if (source.includes('verification') || source.includes('ci')) return status.verificationStatus === 'failed';
  return false;
}

async function currentActionStatus(issueId: string): Promise<LegacyActionStatus | null> {
  const { getReviewStatusSync } = await import('../review-status.js');
  return getReviewStatusSync(issueId);
}

export async function listMailboxItems(options: MailboxAddress): Promise<MailboxItem[]> {
  const workspacePath = resolveWorkspacePath(options);
  if (!workspacePath) return [];
  const files = await Effect.runPromise(readFeedback(workspacePath));
  let legacyStatus: LegacyActionStatus | null | undefined;
  const items: MailboxItem[] = [];

  for (const file of files) {
    if (!NUMBERED_FEEDBACK.test(file.filename)) continue;
    const parsed = parseMailboxMarkdown(file.content);
    if (parsed.metadata) {
      if (parsed.metadata.issueId.toUpperCase() !== options.issueId.toUpperCase() || parsed.metadata.role !== options.role) continue;
      items.push({ ...parsed.metadata, legacy: false, markdownBody: parsed.markdownBody });
      continue;
    }

    if (options.role !== 'work') continue;
    legacyStatus ??= await currentActionStatus(options.issueId);
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
  const workspacePath = resolveWorkspacePath(options);
  if (!workspacePath) throw new Error(`Workspace not found for ${options.issueId}`);
  const absolutePath = isAbsolute(options.filePath)
    ? options.filePath
    : join(getWorkspacePanPaths(workspacePath).feedbackDir, options.filePath);
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
  if (rendered !== content) await writeFile(absolutePath, rendered, 'utf8');
  return item;
}

export function markMailboxItemDelivered(options: MailboxTransitionOptions): Promise<MailboxItem> {
  return transitionMailboxItem(options, 'delivered');
}

export function markMailboxItemAcknowledged(options: MailboxTransitionOptions): Promise<MailboxItem> {
  return transitionMailboxItem(options, 'acknowledged');
}
