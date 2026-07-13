import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';

import { Option } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { compactConversationNative, shouldInterceptManualCompact } from '../../dashboard/server/services/conversation-compaction.js';
import { watchForEatenConversationMessage } from '../../dashboard/server/services/conversation-eaten-message-watcher.js';
import { modelSupportsImagesSync } from '../model-capabilities.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { captureTranscriptUserRecordSnapshot } from '../transcript-landing.js';
import { deliverAgentMessage, injectPiConversationMemory } from '../agents.js';
import {
  extractConversationAttachmentPaths,
  ensureConversationAttachmentDir,
  getConversationAttachmentsRoot,
  hasConversationAttachment,
  isManagedConversationAttachmentPath,
  removeConversationAttachment,
} from '../../dashboard/server/services/conversation-attachments.js';
import {
  getConversationByName,
  setConversationClaudeSessionId,
  updateConversationTitle,
  type LegacyConversation as Conversation,
} from './conversations.js';
import { derivePromptTitle } from '../conversations/transcript-summary.js';
import {
  deliverConversationViaControlChannel,
  isPiControlChannelHarness,
  pickDeliverAs,
  resolveConversationDeliveryMethod,
} from './conversation-delivery.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 50_000;
const MAX_FILENAME_LENGTH = 255;
const UPLOAD_READ_TIMEOUT_MS = 10_000;
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
const UPLOAD_RATE_LIMIT_MAX = 10;
const UPLOAD_RATE_LIMIT_MAP_MAX = 1_000;
const uploadRateLimit = new Map<string, { count: number; resetAt: number }>();
let lastRateLimitPruneAt = 0;

function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function resolveConversationUploadClientIp(
  remoteAddressOption: Option.Option<string>,
  forwardedFor: string | undefined,
): string {
  const remoteAddress = Option.getOrElse(remoteAddressOption, () => 'unknown');
  // Only trust X-Forwarded-From when the direct connection comes from a
  // loopback address (i.e. we are behind a local reverse proxy). Otherwise
  // a client can spoof any IP and bypass rate-limiting.
  if (isLoopbackAddress(remoteAddress) && forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return remoteAddress;
}

const ALLOWED_UPLOAD_MIME_TYPES = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

export const IMAGE_ATTACHMENT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.log',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.sh',
  '.bash',
  '.sql',
  '.diff',
  '.patch',
  '.ini',
  '.conf',
  '.cfg',
  '.pdf',
] as const;

export function isImageAttachmentPath(path: string): boolean {
  return IMAGE_ATTACHMENT_EXTENSIONS.includes(extname(path).toLowerCase() as typeof IMAGE_ATTACHMENT_EXTENSIONS[number]);
}

export interface UploadValidationError {
  error: string;
  status: number;
}

function validateImageMagicBytes(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    case 'image/gif':
      return bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export function validateUploadPayload(filename: string, mimeType: string, bytes: Buffer): UploadValidationError | null {
  if (ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    if (!validateImageMagicBytes(bytes, mimeType)) {
      return { error: 'File content does not match declared MIME type', status: 400 };
    }
    return null;
  }

  // Unsupported image MIME types keep the legacy error shape for backwards compatibility.
  if (mimeType.startsWith('image/')) {
    return { error: `Unsupported mimeType: ${mimeType}`, status: 400 };
  }

  const ext = extname(filename).toLowerCase();

  if (ext === '.pdf') {
    if (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    ) {
      return null;
    }
    return { error: 'File content does not match declared file type', status: 400 };
  }

  if (ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext as typeof ALLOWED_ATTACHMENT_EXTENSIONS[number])) {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      decoder.decode(bytes);
      if (bytes.includes(0)) {
        return { error: 'File content does not match declared file type', status: 400 };
      }
      return null;
    } catch {
      return { error: 'File content does not match declared file type', status: 400 };
    }
  }

  return { error: `Unsupported file type: ${ext || mimeType}`, status: 400 };
}

function sanitizeUploadBasename(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return cleaned.slice(0, 48) || 'file';
}

export interface ConversationMessageDependencies {
  resolveSessionFile(conv: Conversation): Promise<string | null>;
  generateAiTitle(name: string, message: string): Promise<void>;
}

export function safeUploadExtension(filename: string, mimeType: string): string {
  const mimeExtension = ALLOWED_UPLOAD_MIME_TYPES.get(mimeType);
  const originalExtension = extname(filename).toLowerCase();
  if (mimeExtension) {
    return originalExtension === mimeExtension ? originalExtension : mimeExtension;
  }
  if (ALLOWED_ATTACHMENT_EXTENSIONS.includes(originalExtension as typeof ALLOWED_ATTACHMENT_EXTENSIONS[number])) {
    return originalExtension;
  }
  return '';
}

export async function handleConversationImageUpload(
  name: string,
  filename: string,
  bytes: Buffer,
  mimeType: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

  if (!filename || !mimeType) {
    return jsonResponse({ error: 'filename and mimeType are required' }, { status: 400 });
  }
  if (filename.length > MAX_FILENAME_LENGTH) {
    return jsonResponse({ error: `filename exceeds maximum length of ${MAX_FILENAME_LENGTH} characters` }, { status: 400 });
  }
  if (bytes.length === 0) return jsonResponse({ error: 'Payload is empty' }, { status: 400 });
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: `Payload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes` }, { status: 400 });
  }

  const validation = validateUploadPayload(filename, mimeType, bytes);
  if (validation) {
    return jsonResponse({ error: validation.error }, { status: validation.status });
  }

  const extension = safeUploadExtension(filename, mimeType);
  if (!extension) {
    return jsonResponse({ error: `Unsupported file type: ${extname(filename).toLowerCase() || mimeType}` }, { status: 400 });
  }
  if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

  const attachmentDir = await ensureConversationAttachmentDir(name);
  let resolvedDir: string;
  let attachmentsRoot: string;
  try {
    resolvedDir = await realpath(attachmentDir);
    attachmentsRoot = await realpath(getConversationAttachmentsRoot());
  } catch (err) {
    console.error('[conversations] Failed to resolve attachment path:', err);
    return jsonResponse({ error: 'Attachment directory is misconfigured' }, { status: 500 });
  }
  if (!resolvedDir.startsWith(`${attachmentsRoot}/`)) {
    return jsonResponse({ error: 'Invalid attachment path' }, { status: 500 });
  }

  let fileName: string;
  if (ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    fileName = `${randomUUID()}${extension}`;
  } else {
    const base = basename(filename, extension);
    const sanitized = sanitizeUploadBasename(base);
    fileName = `${randomUUID()}-${sanitized}${extension}`;
  }
  const path = join(resolvedDir, fileName);
  const tmpPath = `${path}.tmp`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, path);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  return jsonResponse({ path });
}

export function checkConversationUploadRateLimit(remoteAddress: string): boolean {
  const now = Date.now();
  // Prune stale entries at most once per rate-limit window to avoid O(n)
  // scans on every request. The hard size cap is still enforced after pruning.
  if (now - lastRateLimitPruneAt > UPLOAD_RATE_LIMIT_WINDOW_MS) {
    lastRateLimitPruneAt = now;
    for (const [ip, entry] of uploadRateLimit) {
      if (now > entry.resetAt) {
        uploadRateLimit.delete(ip);
      }
    }
  }
  // If still over cap after pruning stale entries, evict oldest entries
  // (Map iteration order is insertion order).
  while (uploadRateLimit.size >= UPLOAD_RATE_LIMIT_MAP_MAX) {
    const firstKey = uploadRateLimit.keys().next().value;
    if (firstKey !== undefined) {
      uploadRateLimit.delete(firstKey);
    } else {
      break;
    }
  }
  const entry = uploadRateLimit.get(remoteAddress);
  if (!entry || now > entry.resetAt) {
    uploadRateLimit.set(remoteAddress, { count: 1, resetAt: now + UPLOAD_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= UPLOAD_RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

export async function handleConversationImageUploadFile(
  name: string,
  filename: string,
  filePath: string,
  mimeType: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const bytes = await Promise.race([
    readFile(filePath),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Upload read timeout')), UPLOAD_READ_TIMEOUT_MS),
    ),
  ]);
  return handleConversationImageUpload(name, filename, bytes, mimeType);
}

export async function handleConversationImageDelete(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }
  const path = typeof body['path'] === 'string' ? body['path'].trim() : '';
  if (!path) {
    return jsonResponse({ error: 'path is required' }, { status: 400 });
  }
  const removed = await removeConversationAttachment(name, path);
  if (!removed) {
    return jsonResponse({ error: 'Attachment not found for conversation' }, { status: 404 });
  }
  return jsonResponse({ ok: true });
}

export function transformMessageForHarness(message: string, harness: RuntimeName, attachmentPaths: string[]): string {
  if (getHarnessBehavior(harness).transcriptKind === 'claude-jsonl') return message;
  if (attachmentPaths.length === 0) return message;

  let userText = message;
  for (const path of attachmentPaths) {
    userText = userText.split(`@${path}`).join('');
  }
  userText = userText.trim();
  const attachments = attachmentPaths.map((path) => `- ${path}`).join('\n');
  if (!userText) {
    return `Use the Read tool to inspect these attached files, then describe what you see:\n${attachments}`;
  }
  return `Use the Read tool to inspect these attached files:\n${attachments}\n\nMessage:\n${userText}`;
}

export function partitionAttachmentsForModel(
  message: string,
  attachmentPaths: string[],
  supportsImages: boolean,
): { outboundMessage: string; effectiveAttachmentPaths: string[]; droppedImageCount: number } {
  if (attachmentPaths.length === 0 || supportsImages) {
    return { outboundMessage: message, effectiveAttachmentPaths: attachmentPaths, droppedImageCount: 0 };
  }

  const imagePaths = attachmentPaths.filter((p) => isImageAttachmentPath(p));
  const nonImagePaths = attachmentPaths.filter((p) => !isImageAttachmentPath(p));

  let outboundMessage = message;
  for (const p of imagePaths) {
    outboundMessage = outboundMessage.split(`@${p}`).join('');
  }
  outboundMessage = outboundMessage.trim();

  return {
    outboundMessage,
    effectiveAttachmentPaths: nonImagePaths,
    droppedImageCount: imagePaths.length,
  };
}

export async function handleConversationMessage(
  name: string,
  body: Record<string, unknown>,
  deps: ConversationMessageDependencies = {
    resolveSessionFile: async () => null,
    generateAiTitle: async () => {},
  },
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
  if (!message) return jsonResponse({ error: 'Message is required' }, { status: 400 });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 });
  }

  if (getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl' && shouldInterceptManualCompact(message)) {
    const compactSessionFile = await deps.resolveSessionFile(conv);
    if (!compactSessionFile || !existsSync(compactSessionFile)) {
      return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
    }
    const compactResult = await compactConversationNative(compactSessionFile, conv.name);
    setConversationClaudeSessionId(conv.name, compactResult.forkedSessionId);
    return jsonResponse({ ok: true, compacted: true, mode: 'overdeck-native', model: compactResult.model });
  }

  const allAttachmentPaths = extractConversationAttachmentPaths(message);
  const managedChecks = await Promise.all(
    allAttachmentPaths.map(async (attachmentPath) => {
      const managed = await isManagedConversationAttachmentPath(attachmentPath);
      if (!managed) return { managed: false as const, attachmentPath };
      const hasAttachment = await hasConversationAttachment(conv.name, attachmentPath);
      return { managed: true as const, attachmentPath, hasAttachment };
    }),
  );
  for (const check of managedChecks) {
    if (check.managed && !check.hasAttachment) {
      return jsonResponse({ error: 'One or more attached images are unavailable for this conversation' }, { status: 400 });
    }
  }
  const managedAttachmentPaths = managedChecks
    .filter((c): c is { managed: true; attachmentPath: string; hasAttachment: boolean } => c.managed)
    .map((c) => c.attachmentPath);

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  const behavior = getHarnessBehavior(harness);
  const supportsImages = modelSupportsImagesSync(conv.model ?? '');
  const partition = partitionAttachmentsForModel(message, managedAttachmentPaths, supportsImages);
  const outboundMessage = partition.outboundMessage;
  const effectiveAttachmentPaths = partition.effectiveAttachmentPaths;
  const droppedImageCount = partition.droppedImageCount;

  if (droppedImageCount > 0 && !outboundMessage && effectiveAttachmentPaths.length === 0) {
    return jsonResponse(
      { error: `${conv.model ?? 'This model'} can't read images. Switch to a vision-capable model (e.g. mimo-v2.5) to send images.` },
      { status: 422 },
    );
  }

  let deliveredMessage = transformMessageForHarness(outboundMessage, harness, effectiveAttachmentPaths);
  if (behavior.injectsPromptTimeMemory) {
    deliveredMessage = await injectPiConversationMemory(
      { cwd: conv.cwd, issueId: conv.issueId, conversationName: conv.name },
      deliveredMessage,
    );
  }

  if (isPiControlChannelHarness(harness)) {
    await deliverConversationViaControlChannel(conv, deliveredMessage, {
      source: 'operator',
      deliverAs: pickDeliverAs(body['deliverAs']),
    });
  } else {
    let watchFromByteOffset: number | null = null;
    if (behavior.transcriptKind === 'claude-jsonl' && conv.claudeSessionId) {
      const snapshot = await captureTranscriptUserRecordSnapshot(conv.cwd, conv.claudeSessionId);
      watchFromByteOffset = snapshot.readOffset ?? snapshot.fileSize ?? 0;
    }

    try {
      await deliverAgentMessage(
        conv.tmuxSession,
        deliveredMessage,
        'conversation-message',
        resolveConversationDeliveryMethod(conv),
      );
    } catch (deliveryErr: unknown) {
      const errMsg = deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr);
      if (errMsg.includes('MessageDeliveryFailed')) {
        return jsonResponse({ error: errMsg.replace('MessageDeliveryFailed: ', '') }, { status: 503 });
      }
      throw deliveryErr;
    }

    if (watchFromByteOffset !== null && conv.claudeSessionId) {
      void watchForEatenConversationMessage({
        conversationName: conv.name,
        tmuxSession: conv.tmuxSession,
        cwd: conv.cwd,
        sessionId: conv.claudeSessionId,
        message: deliveredMessage,
        deliveryMethod: resolveConversationDeliveryMethod(conv),
        fromByteOffset: watchFromByteOffset,
      }).then((outcome) => {
        if (outcome === 'redelivered') {
          console.log(`[conversations] ${conv.name}: redelivered message eaten by submit-time compaction (PAN-1635)`);
        }
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[conversations] eaten-message watcher failed for ${conv.name}: ${msg}`);
      });
    }
  }

  if (conv.titleSource === 'default') {
    const derivedTitle = derivePromptTitle(message);
    if (derivedTitle) {
      updateConversationTitle(name, derivedTitle, 'auto');
    }
    void deps.generateAiTitle(name, message).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
    });
  }

  return jsonResponse({ ok: true, ...(droppedImageCount > 0 ? { imagesDropped: droppedImageCount } : {}) });
}
