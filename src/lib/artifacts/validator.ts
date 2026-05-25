import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ArtifactValidationFinding, ArtifactValidationResult } from '@panctl/contracts';

export const MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024;

export interface ValidateArtifactHtmlOptions {
  strict?: boolean;
  maxBytes?: number;
}

interface LocatedFindingInput {
  code: ArtifactValidationFinding['code'];
  message: string;
  index?: number;
  rule?: string;
  strict?: boolean;
}

const ASSET_ATTRS = new Set(['src', 'poster', 'data', 'xlink:href']);
const TAG_PATTERN = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
const ATTR_PATTERN = /([:@\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const CSS_URL_PATTERN = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const ENTROPY_CANDIDATE_PATTERN = /[A-Za-z0-9+/=_-]{20,}/g;
const ALLOW_SECRET_MARKER = '<!-- artifact-allow-secret -->';

const SECRET_RULES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'aws_access_key_id', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'github_pat', pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'github_oauth_token', pattern: /gho_[A-Za-z0-9]{36}/g },
  { name: 'github_fine_grained_pat', pattern: /github_pat_[A-Za-z0-9_]{82}/g },
  { name: 'anthropic_api_key', pattern: /sk-ant-(api03|admin01)-[A-Za-z0-9_-]{86,}/g },
  { name: 'openai_api_key', pattern: /sk-(proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'slack_token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private_key', pattern: /-----BEGIN (RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----/g },
  { name: 'env_secret_assignment', pattern: /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
];

export async function validateArtifactHtml(
  filePath: string,
  options: ValidateArtifactHtmlOptions = {},
): Promise<ArtifactValidationResult> {
  const maxBytes = options.maxBytes ?? MAX_ARTIFACT_SIZE_BYTES;
  const strict = options.strict === true;
  const errors: ArtifactValidationFinding[] = [];

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return buildResult({ filePath, content: '', size: 0, strict, errors: [{
      code: 'not_a_file',
      message: 'Artifact path is not a readable HTML file',
    }] });
  }

  if (!fileStat.isFile()) {
    errors.push({ code: 'not_a_file', message: 'Artifact path must be a file' });
  }

  if (!isHtmlFile(filePath)) {
    errors.push({ code: 'invalid_file_type', message: 'Artifact file must have a .html or .htm extension' });
  }

  if (fileStat.size > maxBytes) {
    errors.push({
      code: 'size_limit_exceeded',
      message: `Artifact file must be ${maxBytes} bytes or smaller`,
    });
  }

  if (!fileStat.isFile()) {
    return buildResult({ filePath, content: '', size: fileStat.size, strict, errors });
  }

  const content = fileStat.size <= maxBytes ? await readFile(filePath, 'utf-8') : '';
  return validateArtifactHtmlContent(content, { filePath, strict, maxBytes, initialErrors: errors });
}

export function validateArtifactHtmlContent(
  content: string,
  options: ValidateArtifactHtmlOptions & { filePath?: string; initialErrors?: ArtifactValidationFinding[] } = {},
): ArtifactValidationResult {
  const maxBytes = options.maxBytes ?? MAX_ARTIFACT_SIZE_BYTES;
  const strict = options.strict === true;
  const size = Buffer.byteLength(content, 'utf-8');
  const errors = [...(options.initialErrors ?? [])];
  const warnings: ArtifactValidationFinding[] = [];

  if (size > maxBytes && !errors.some((finding) => finding.code === 'size_limit_exceeded')) {
    errors.push({
      code: 'size_limit_exceeded',
      message: `Artifact file must be ${maxBytes} bytes or smaller`,
    });
  }

  scanAssetReferences(content, errors);
  scanSecrets(content, errors, warnings);
  if (strict) {
    scanStrictFindings(content, warnings);
  }

  return {
    ok: errors.length === 0,
    ...(options.filePath ? { filePath: options.filePath } : {}),
    size,
    hash: hashArtifactContent(content),
    strict,
    errors,
    warnings,
  };
}

export function hashArtifactContent(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function isHtmlFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

function buildResult(input: {
  filePath: string;
  content: string;
  size: number;
  strict: boolean;
  errors: ArtifactValidationFinding[];
}): ArtifactValidationResult {
  return {
    ok: false,
    filePath: input.filePath,
    size: input.size,
    hash: hashArtifactContent(input.content),
    strict: input.strict,
    errors: input.errors,
    warnings: [],
  };
}

function scanAssetReferences(content: string, errors: ArtifactValidationFinding[]): void {
  for (const tagMatch of content.matchAll(TAG_PATTERN)) {
    const tagName = tagMatch[1].toLowerCase();
    const attrSource = tagMatch[2];
    const attrs = parseAttributes(attrSource);
    const tagOffset = tagMatch.index ?? 0;

    const isStylesheetLink = tagName === 'link' && attrs.some((attr) => (
      attr.name.toLowerCase() === 'rel' && attr.value.toLowerCase().split(/\s+/).includes('stylesheet')
    ));

    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (tagName === 'script' && name === 'src') {
        addForbiddenScriptOrStylesheetIfNeeded(content, errors, attr.value, tagOffset + attr.index, 'script.src');
      } else if (isStylesheetLink && name === 'href') {
        addForbiddenScriptOrStylesheetIfNeeded(content, errors, attr.value, tagOffset + attr.index, 'link.href');
      } else if (ASSET_ATTRS.has(name) || (name === 'href' && tagName === 'link')) {
        addForbiddenAssetIfNeeded(content, errors, attr.value, tagOffset + attr.index, `${tagName}.${name}`);
      }
      if (name === 'srcset') {
        for (const srcsetUrl of parseSrcset(attr.value)) {
          addForbiddenAssetIfNeeded(content, errors, srcsetUrl, tagOffset + attr.index, `${tagName}.srcset`);
        }
      }
    }
  }

  for (const match of content.matchAll(CSS_URL_PATTERN)) {
    addForbiddenAssetIfNeeded(content, errors, match[2], match.index, 'css.url');
  }
}

function parseAttributes(source: string): Array<{ name: string; value: string; index: number }> {
  const attrs: Array<{ name: string; value: string; index: number }> = [];
  for (const match of source.matchAll(ATTR_PATTERN)) {
    attrs.push({
      name: match[1],
      value: match[3] ?? match[4] ?? match[5] ?? '',
      index: match.index ?? 0,
    });
  }
  return attrs;
}

function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function addForbiddenAssetIfNeeded(
  content: string,
  errors: ArtifactValidationFinding[],
  rawUrl: string,
  index: number | undefined,
  rule: string,
): void {
  const url = rawUrl.trim();
  if (url.length === 0 || isAllowedAssetUrl(url)) return;
  errors.push(locatedFinding(content, {
    code: 'forbidden_asset_url',
    message: `Artifact asset URL must be data: or HTTPS: ${url}`,
    index,
    rule,
  }));
}

function addForbiddenScriptOrStylesheetIfNeeded(
  content: string,
  errors: ArtifactValidationFinding[],
  rawUrl: string,
  index: number | undefined,
  rule: string,
): void {
  const url = rawUrl.trim();
  if (url.length === 0 || url.toLowerCase().startsWith('data:')) return;
  errors.push(locatedFinding(content, {
    code: 'forbidden_asset_url',
    message: `Artifact stylesheet and script URLs must be data: URLs: ${url}`,
    index,
    rule,
  }));
}

function isAllowedAssetUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('#');
}

function scanSecrets(
  content: string,
  errors: ArtifactValidationFinding[],
  warnings: ArtifactValidationFinding[],
): void {
  let offset = 0;
  for (const line of content.split(/\r?\n/)) {
    const suppressed = line.includes(ALLOW_SECRET_MARKER);
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        const finding = locatedFinding(content, {
          code: suppressed ? 'secret_allowed' : 'secret_detected',
          message: suppressed
            ? `Suppressed possible ${rule.name} match`
            : `Possible ${rule.name} found in artifact HTML`,
          index: offset + (match.index ?? 0),
          rule: rule.name,
        });
        if (suppressed) {
          warnings.push(finding);
        } else {
          errors.push(finding);
        }
      }
    }
    offset += line.length + 1;
  }
}

function scanStrictFindings(content: string, warnings: ArtifactValidationFinding[]): void {
  scanHighEntropyStrings(content, warnings);
  scanInlineEventHandlers(content, warnings);
  scanMissingImageAltText(content, warnings);
}

function scanHighEntropyStrings(content: string, warnings: ArtifactValidationFinding[]): void {
  for (const match of content.matchAll(ENTROPY_CANDIDATE_PATTERN)) {
    const value = match[0];
    if (shannonEntropy(value) <= 4.5) continue;
    warnings.push(locatedFinding(content, {
      code: 'high_entropy_string',
      message: 'High-entropy string found in strict mode',
      index: match.index,
      rule: 'entropy',
      strict: true,
    }));
  }
}

function scanInlineEventHandlers(content: string, warnings: ArtifactValidationFinding[]): void {
  if (hasContentSecurityPolicy(content)) return;
  for (const tagMatch of content.matchAll(TAG_PATTERN)) {
    const attrs = parseAttributes(tagMatch[2]);
    const eventAttr = attrs.find((attr) => attr.name.toLowerCase().startsWith('on'));
    if (!eventAttr) continue;
    warnings.push(locatedFinding(content, {
      code: 'inline_event_handler',
      message: 'Inline event handler found without a Content-Security-Policy meta tag',
      index: (tagMatch.index ?? 0) + eventAttr.index,
      rule: eventAttr.name.toLowerCase(),
      strict: true,
    }));
  }
}

function scanMissingImageAltText(content: string, warnings: ArtifactValidationFinding[]): void {
  for (const tagMatch of content.matchAll(TAG_PATTERN)) {
    if (tagMatch[1].toLowerCase() !== 'img') continue;
    const attrs = parseAttributes(tagMatch[2]);
    const alt = attrs.find((attr) => attr.name.toLowerCase() === 'alt');
    if (alt && alt.value.trim().length > 0) continue;
    warnings.push(locatedFinding(content, {
      code: 'missing_image_alt',
      message: 'Image is missing non-empty alt text in strict mode',
      index: tagMatch.index,
      rule: 'img.alt',
      strict: true,
    }));
  }
}

function hasContentSecurityPolicy(content: string): boolean {
  return /<meta\s+[^>]*http-equiv\s*=\s*['"]Content-Security-Policy['"][^>]*>/i.test(content);
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return Array.from(counts.values()).reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function locatedFinding(content: string, input: LocatedFindingInput): ArtifactValidationFinding {
  const location = input.index === undefined ? {} : lineColumnForIndex(content, input.index);
  return {
    code: input.code,
    message: input.message,
    ...location,
    ...(input.rule ? { rule: input.rule } : {}),
    ...(input.strict === undefined ? {} : { strict: input.strict }),
  };
}

function lineColumnForIndex(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}
