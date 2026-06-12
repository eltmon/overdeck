import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ArtifactCreateResponse,
  ArtifactListEntry,
  ArtifactListResponse,
  ArtifactMetadata,
  ArtifactPublishResponse,
  ArtifactStatusResponse,
  ArtifactUnshareResponse,
  ArtifactUrls,
  ArtifactValidationResult,
} from '@panctl/contracts';
import {
  ArtifactIndexRepository,
  type ArtifactIndexEntry,
  getArtifactSnapshotPath,
} from './index-store.js';
import { hashArtifactContent, validateArtifactHtml } from './validator.js';

export interface ArtifactProvenanceInput {
  issueId?: string | null;
  workspaceId?: string | null;
  agentRole?: ArtifactMetadata['agentRole'];
  agentHarness?: ArtifactMetadata['agentHarness'];
  runId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  description?: string | null;
}

export interface ArtifactLifecycleOptions {
  repository?: ArtifactIndexRepository;
  now?: () => string;
  baseDomain?: string;
  validation?: { strict?: boolean; maxBytes?: number };
}

export interface CreateArtifactOptions extends ArtifactLifecycleOptions, ArtifactProvenanceInput {}
export interface PublishArtifactOptions extends ArtifactLifecycleOptions {}
export interface StatusArtifactOptions extends ArtifactLifecycleOptions {
  validate?: boolean;
}
export interface ListArtifactsOptions extends ArtifactLifecycleOptions {
  issueId?: string;
  workspaceId?: string;
}
export interface UnshareArtifactOptions extends ArtifactLifecycleOptions {}

export class ArtifactValidationError extends Error {
  constructor(readonly validation: ArtifactValidationResult) {
    super('Artifact HTML validation failed');
  }
}

export async function createArtifact(
  filePath: string,
  options: CreateArtifactOptions = {},
): Promise<ArtifactCreateResponse> {
  const repository = getRepository(options);
  const validation = await validateOrThrow(filePath, options);
  const publishedAt = getNow(options);
  const entry = repository.createArtifact({
    artifactId: randomUUID(),
    filePath,
    currentHash: validation.hash,
    lastPublishedHash: validation.hash,
    title: options.title ?? await extractArtifactTitle(filePath),
    description: options.description ?? null,
    publishedAt,
    createdAt: publishedAt,
    ...resolveProvenance(options),
  });
  await copyPublishedSnapshot(filePath, entry.artifact.slug);

  return {
    artifact: entry.artifact,
    urls: resolveArtifactUrls(entry.artifact.slug, options),
    validation,
    published: true,
  };
}

export async function publishArtifact(
  filePath: string,
  options: PublishArtifactOptions = {},
): Promise<ArtifactPublishResponse> {
  const repository = getRepository(options);
  const existing = repository.getByFilePath(filePath);
  if (!existing) throw new Error(`No artifact exists for ${filePath}`);

  const validation = await validateOrThrow(filePath, options);
  await copyPublishedSnapshot(filePath, existing.artifact.slug);
  const updated = repository.updatePublished(existing.artifact.artifactId, validation.hash, getNow(options));
  if (!updated) throw new Error(`Artifact disappeared while publishing ${filePath}`);

  return {
    artifact: updated.artifact,
    urls: resolveArtifactUrls(updated.artifact.slug, options),
    validation,
    published: true,
    pendingChanges: updated.pendingChanges,
  };
}

export async function getArtifactStatus(
  filePath: string,
  options: StatusArtifactOptions = {},
): Promise<ArtifactStatusResponse> {
  const repository = getRepository(options);
  const validation = options.validate === false ? undefined : await validateArtifactHtml(filePath, options.validation);
  const currentHash = validation?.hash ?? hashArtifactContent(await readFile(filePath));
  const entry = repository.getStatusByFilePath(filePath, currentHash);

  return {
    ...(entry ? { artifact: entry.artifact } : {}),
    filePath,
    currentHash,
    lastPublishedHash: entry?.artifact.lastPublishedHash ?? null,
    pendingChanges: entry?.pendingChanges ?? true,
    ...(validation ? { validation } : {}),
  };
}

export function listArtifacts(options: ListArtifactsOptions = {}): ArtifactListResponse {
  const repository = getRepository(options);
  const entries = options.workspaceId
    ? repository.listByWorkspace(options.workspaceId)
    : options.issueId
      ? repository.listByIssue(options.issueId)
      : repository.listAll();

  return {
    artifacts: entries.map((entry) => toListEntry(entry, options)),
  };
}

export function resolveArtifactUrl(slug: string, options: ArtifactLifecycleOptions = {}): ArtifactUrls {
  return resolveArtifactUrls(slug, options);
}

export function unshareArtifact(
  filePath: string,
  options: UnshareArtifactOptions = {},
): ArtifactUnshareResponse {
  const repository = getRepository(options);
  const existing = repository.getByFilePath(filePath);
  if (!existing) throw new Error(`No artifact exists for ${filePath}`);
  const updated = repository.unshare(existing.artifact.artifactId, getNow(options));
  if (!updated) throw new Error(`Artifact disappeared while unsharing ${filePath}`);

  return {
    artifact: updated.artifact,
    unshared: true,
  };
}

async function validateOrThrow(
  filePath: string,
  options: ArtifactLifecycleOptions,
): Promise<ArtifactValidationResult> {
  const validation = await validateArtifactHtml(filePath, options.validation);
  if (!validation.ok) throw new ArtifactValidationError(validation);
  return validation;
}

async function copyPublishedSnapshot(filePath: string, slug: string): Promise<void> {
  const snapshotPath = getArtifactSnapshotPath(slug);
  await mkdir(dirname(snapshotPath), { recursive: true });
  await copyFile(filePath, snapshotPath);
}

async function extractArtifactTitle(filePath: string): Promise<string | null> {
  const content = await readFile(filePath, 'utf-8');
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content);
  if (!match) return null;
  const title = decodeHtmlText(match[1]).trim();
  return title.length > 0 ? title : null;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveProvenance(input: ArtifactProvenanceInput): ArtifactProvenanceInput {
  return {
    issueId: input.issueId ?? process.env.PAN_ISSUE_ID ?? null,
    workspaceId: input.workspaceId ?? process.env.PAN_WORKSPACE_ID ?? null,
    agentRole: input.agentRole ?? parseAgentRole(process.env.PAN_AGENT_ROLE),
    agentHarness: input.agentHarness ?? parseAgentHarness(process.env.PAN_AGENT_HARNESS),
    runId: input.runId ?? process.env.PAN_RUN_ID ?? null,
    sessionId: input.sessionId ?? process.env.PAN_SESSION_ID ?? null,
  };
}

function parseAgentRole(value: string | undefined): ArtifactMetadata['agentRole'] {
  if (value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship' || value === 'flywheel' || value === 'user') {
    return value;
  }
  return null;
}

function parseAgentHarness(value: string | undefined): ArtifactMetadata['agentHarness'] {
  if (value === 'claude-code' || value === 'pi' || value === 'codex' || value === 'user') {
    return value;
  }
  return null;
}

function resolveArtifactUrls(slug: string, options: ArtifactLifecycleOptions): ArtifactUrls {
  const domain = options.baseDomain ?? process.env.PAN_ARTIFACT_DOMAIN ?? 'pan.localhost';
  return {
    wrapperUrl: `https://${domain}/s/${slug}`,
    rawUrl: `https://artifacts.${domain}/a/${slug}`,
  };
}

function toListEntry(entry: ArtifactIndexEntry, options: ArtifactLifecycleOptions): ArtifactListEntry {
  return {
    artifact: entry.artifact,
    urls: resolveArtifactUrls(entry.artifact.slug, options),
    status: entry.status,
    pendingChanges: entry.pendingChanges,
  };
}

function getRepository(options: ArtifactLifecycleOptions): ArtifactIndexRepository {
  return options.repository ?? new ArtifactIndexRepository();
}

function getNow(options: ArtifactLifecycleOptions): string {
  return options.now?.() ?? new Date().toISOString();
}
