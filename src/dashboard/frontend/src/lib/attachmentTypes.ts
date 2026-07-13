/**
 * Attachment classification shared between the composer store and UI.
 *
 * Mirrors the server allowlist in src/lib/overdeck/conversation-message.ts.
 * Cross-reference both directions when changing either file.
 */

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

export type AttachmentKind = 'image' | 'file';

function extname(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot <= 0 ? '' : filename.slice(lastDot).toLowerCase();
}

const EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/jsonlines',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.sql': 'application/sql',
  '.diff': 'text/x-diff',
  '.patch': 'text/x-diff',
  '.ini': 'text/plain',
  '.conf': 'text/plain',
  '.cfg': 'text/plain',
  '.pdf': 'application/pdf',
};

export function classifyAttachmentKind(file: File): AttachmentKind | null {
  if (isDotfileAttachment(file.name) || isExtensionlessAttachment(file.name)) return null;
  const ext = extname(file.name);
  if ((IMAGE_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext as typeof IMAGE_ATTACHMENT_EXTENSIONS[number])) return 'image';
  if ((ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) return 'file';
  return null;
}

export function inferAttachmentMime(file: File): string {
  if (file.type) return file.type;
  const ext = extname(file.name);
  return EXTENSION_TO_MIME[ext] ?? 'text/plain';
}

/** Filename starts with a dot (e.g. `.env`). File names are basename-only here. */
export function isDotfileAttachment(filename: string): boolean {
  return filename.startsWith('.');
}

/** No extension and not a dotfile (e.g. `Makefile`). */
export function isExtensionlessAttachment(filename: string): boolean {
  return !isDotfileAttachment(filename) && extname(filename) === '';
}

export const ATTACHMENT_ACCEPT = [...IMAGE_ATTACHMENT_EXTENSIONS, ...ALLOWED_ATTACHMENT_EXTENSIONS].join(',');
