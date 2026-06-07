/**
 * ChatMarkdown (PAN-451)
 *
 * Renders markdown content from assistant messages. Uses react-markdown with
 * remark-gfm for GitHub Flavored Markdown support and @pierre/diffs for Shiki
 * syntax highlighting with LRU cache.
 *
 * This is the full implementation — no stubs. Features:
 *   - GFM markdown (headers, lists, tables, strikethrough, etc.)
 *   - Shiki syntax highlighting with 500-entry LRU cache
 *   - Cache skipped during streaming to show progressive text
 *   - Copy button on code blocks (hover to reveal)
 *   - Error boundary falls back to plain text on highlight failure
 */

import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { Streamdown, defaultRehypePlugins, type StreamdownProps } from 'streamdown';
import 'streamdown/styles.css';
import { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { CheckIcon, CopyIcon } from 'lucide-react';
import type { Components } from 'react-markdown';
import type { DiffsThemeNames } from '@pierre/diffs';
import { resolveMarkdownFileLinkMeta, shouldPreserveMarkdownFileLinkHref, splitMarkdownTextFileLinks, type MarkdownFileLinkMeta } from '../../markdown-links';
import { MarkdownFileLink } from './MarkdownFileLink';
import { useFilePathExists } from '../../hooks/useFilePathExists';
import { LRUCache } from '../../lib/lruCache';
import styles from '../CommandDeck/styles/command-deck.module.css';

// ─── LRU Cache for syntax highlighting ───────────────────────────────────────

const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

/** FNV-1a 32-bit hash — fast cache key for code blocks */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function cacheKey(code: string, lang: string): string {
  return `${fnv1a32(code)}:${code.length}:${lang}`;
}

/** Sanitize Shiki HTML output before rendering with dangerouslySetInnerHTML.
 *  Only allows the tags and attributes that Shiki legitimately produces. */
const ALLOWED_SHIKI_TAGS = new Set(['span', 'pre', 'code', 'div', 'br']);
const ALLOWED_SHIKI_ATTRS = new Set(['class', 'style']);

const ALLOWED_CSS_PROPERTIES = new Set([
  'color', 'background-color', 'font-style', 'font-weight',
  'text-decoration', 'opacity',
]);

function sanitizeStyleAttr(styleValue: string): string {
  return styleValue.split(';')
    .map((d) => d.trim()).filter(Boolean)
    .filter((d) => {
      const [prop] = d.split(':');
      return prop && ALLOWED_CSS_PROPERTIES.has(prop.trim().toLowerCase());
    })
    .join('; ');
}

const sharedDomParser = new DOMParser();

function sanitizeShikiHtml(html: string): string {
  const doc = sharedDomParser.parseFromString(html, 'text/html');

  function walk(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    if (!ALLOWED_SHIKI_TAGS.has(tagName)) {
      return null;
    }
    const newEl = document.createElement(tagName);
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_SHIKI_ATTRS.has(attr.name.toLowerCase())) continue;
      if (attr.name === 'style') {
        const safe = sanitizeStyleAttr(attr.value);
        if (safe) newEl.setAttribute('style', safe);
      } else {
        newEl.setAttribute(attr.name, attr.value);
      }
    }
    for (const child of Array.from(el.childNodes)) {
      const sanitized = walk(child);
      if (sanitized) newEl.appendChild(sanitized);
    }
    return newEl;
  }

  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const sanitized = walk(child);
    if (sanitized) fragment.appendChild(sanitized);
  }
  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}

// ─── Highlighter (lazy-loaded) ────────────────────────────────────────────────

let sharedHighlighterPromise: Promise<unknown> | null = null;

async function getHighlighter() {
  if (!sharedHighlighterPromise) {
    sharedHighlighterPromise = import('@pierre/diffs').then((m) =>
      m.getSharedHighlighter({ themes: ['github-dark' as DiffsThemeNames], langs: [] }),
    );
  }
  return sharedHighlighterPromise;
}

async function highlightCode(
  code: string,
  lang: string,
  isStreaming: boolean,
): Promise<string> {
  const key = cacheKey(code, lang);
  if (!isStreaming) {
    const cached = highlightCache.get(key);
    if (cached !== null) return cached;
  }

  try {
    const highlighter = await getHighlighter() as {
      codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
    };
    const html = highlighter.codeToHtml(code, {
      lang: lang || 'text',
      theme: 'github-light',
    });
    if (!isStreaming) highlightCache.set(key, html, estimateHighlightedSize(html, code));
    return html;
  } catch {
    // Unknown language — return escaped plaintext
    return `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  }
}

// ─── Error boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean }
class ChatMarkdownErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ─── Code block with syntax highlighting ─────────────────────────────────────

interface CodeBlockProps {
  code: string;
  lang: string;
  isStreaming: boolean;
}

function CodeBlock({ code, lang, isStreaming }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;
    highlightCode(code, lang, isStreaming).then((html) => {
      if (!abortRef.current) setHighlighted(html);
    });
    return () => { abortRef.current = true; };
  }, [code, lang, isStreaming]);

  const sanitizedHtml = useMemo(
    () => (highlighted ? sanitizeShikiHtml(highlighted) : null),
    [highlighted],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className={styles.codeBlock}>
      <button
        className={styles.copyButton}
        onClick={handleCopy}
        title="Copy code"
      >
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
      {sanitizedHtml ? (
        <div
          className={styles.shikiOutput}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      ) : (
        <pre className={styles.codePlain}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ─── Custom markdown components ───────────────────────────────────────────────

function transformMarkdownUrl(url: string): string {
  return shouldPreserveMarkdownFileLinkHref(url) ? url : defaultUrlTransform(url);
}

type ReactMarkdownRemarkPlugins = React.ComponentProps<typeof ReactMarkdown>['remarkPlugins'];
type StreamdownComponents = NonNullable<StreamdownProps['components']>;

interface ChatMarkdownSettings {
  experimental?: {
    streamdownRenderer?: boolean;
  };
}

async function fetchChatMarkdownSettings(): Promise<ChatMarkdownSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('settings fetch failed');
  return res.json();
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
}

const TEXT_LINK_SKIP_NODE_TYPES = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition']);

const streamdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    // Streamdown sanitizes before its urlTransform hook. Leave href protocol
    // filtering to rehype-harden + transformMarkdownUrl so file-link hrefs like
    // `package.json:1` survive while javascript:/data:/vbscript: remain blocked.
    href: undefined,
  },
};

const streamdownRehypePlugins = [
  defaultRehypePlugins.raw,
  [(defaultRehypePlugins.sanitize as unknown[])[0], streamdownSanitizeSchema],
  defaultRehypePlugins.harden,
] as unknown as StreamdownProps['rehypePlugins'];

const StreamdownRenderer = Streamdown as React.ComponentType<StreamdownProps>;

/**
 * Gates MarkdownFileLink chip rendering on a server-side existence check
 * (PAN-1457). The regex heuristic in markdown-links.ts decides whether a
 * token looks path-shaped; this component asks the server whether the
 * candidate actually resolves to a file or directory under cwd. Phantom
 * paths like `conv/2209` render as plain text via the fallback prop;
 * confirmed files and directories render as the full chip.
 */
function MaybeFileLinkChip({
  meta,
  cwd,
  issueId,
  fallback,
}: {
  meta: MarkdownFileLinkMeta;
  cwd?: string;
  issueId?: string | null;
  fallback: ReactNode;
}) {
  const { state } = useFilePathExists(cwd, meta.filePath) as { state: string };
  if (state === 'exists') {
    return <MarkdownFileLink {...meta} issueId={issueId} />;
  }
  return <>{fallback}</>;
}

function remarkBareFileTextLinks(options: { cwd?: string } = {}) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || TEXT_LINK_SKIP_NODE_TYPES.has(node.type)) return;

      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value !== undefined) {
          for (const segment of splitMarkdownTextFileLinks(child.value, options.cwd)) {
            children.push(segment.href
              ? {
                type: 'link',
                url: segment.href,
                title: null,
                children: [{ type: 'text', value: segment.text }],
              }
              : { type: 'text', value: segment.text });
          }
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };

    visit(tree);
  };
}

function makeComponents(isStreaming: boolean, cwd: string | undefined, issueId: string | null | undefined): Components & StreamdownComponents {
  return {
    pre({ children }) {
      // Extract code block contents
      const child = React.Children.toArray(children)[0];
      if (!React.isValidElement(child)) {
        return <pre>{children}</pre>;
      }
      const codeEl = child as React.ReactElement<{
        className?: string;
        children?: ReactNode;
      }>;
      const className = codeEl.props.className ?? '';
      const lang = /language-(\w+)/.exec(className)?.[1] ?? '';
      const code = String(codeEl.props.children ?? '').trimEnd();

      return (
        <ChatMarkdownErrorBoundary
          fallback={
            <pre className={styles.codePlain}>
              <code>{code}</code>
            </pre>
          }
        >
          <CodeBlock code={code} lang={lang} isStreaming={isStreaming} />
        </ChatMarkdownErrorBoundary>
      );
    },
    a({ href, children }) {
      const fileLinkMeta = resolveMarkdownFileLinkMeta(href, cwd);
      if (fileLinkMeta) {
        return (
          <MaybeFileLinkChip
            meta={fileLinkMeta}
            cwd={cwd}
            issueId={issueId}
            fallback={children}
          />
        );
      }

      // Block javascript: and data: URIs to prevent XSS from assistant markdown
      const safeHref =
        typeof href === 'string' &&
        href.trim().length > 0 &&
        !/^(javascript|data|vbscript):/i.test(href.trim())
          ? href
          : undefined;
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.mdLink}
        >
          {children}
        </a>
      );
    },
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ChatMarkdownProps {
  text: string;
  isStreaming?: boolean;
  cwd?: string;
  issueId?: string | null;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  isStreaming = false,
  cwd,
  issueId,
}: ChatMarkdownProps) {
  const components = useMemo(() => makeComponents(isStreaming, cwd, issueId), [isStreaming, cwd, issueId]);
  const remarkPlugins = useMemo(
    () => [remarkGfm, [remarkBareFileTextLinks, { cwd }]] as ReactMarkdownRemarkPlugins,
    [cwd],
  );
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchChatMarkdownSettings,
    retry: false,
  });
  const useStreamdown = settings?.experimental?.streamdownRenderer === true;

  return (
    <ChatMarkdownErrorBoundary fallback={<pre className={styles.mdFallback}>{text}</pre>}>
      <div className={styles.chatMarkdown}>
        {useStreamdown ? (
          <StreamdownRenderer
            mode={isStreaming ? 'streaming' : 'static'}
            rehypePlugins={streamdownRehypePlugins}
            remarkPlugins={remarkPlugins as StreamdownProps['remarkPlugins']}
            components={components as StreamdownProps['components']}
            urlTransform={(url) => transformMarkdownUrl(url)}
          >
            {text}
          </StreamdownRenderer>
        ) : (
          <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={transformMarkdownUrl}>
            {text}
          </ReactMarkdown>
        )}
      </div>
    </ChatMarkdownErrorBoundary>
  );
});
