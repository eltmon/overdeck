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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckIcon, CopyIcon } from 'lucide-react';
import type { Components } from 'react-markdown';
import type { DiffsThemeNames } from '@pierre/diffs';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── LRU Cache for syntax highlighting ───────────────────────────────────────

class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, value);
  }
}

const highlightCache = new LRUCache<string, string>(500);

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
    if (cached !== undefined) return cached;
  }

  try {
    const highlighter = await getHighlighter() as {
      codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
    };
    const html = highlighter.codeToHtml(code, {
      lang: lang || 'text',
      theme: 'github-light',
    });
    if (!isStreaming) highlightCache.set(key, html);
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

function makeComponents(isStreaming: boolean): Components {
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
      // Block javascript: and data: URIs to prevent XSS from assistant markdown
      const safeHref =
        typeof href === 'string' &&
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
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  isStreaming = false,
}: ChatMarkdownProps) {
  const components = useMemo(() => makeComponents(isStreaming), [isStreaming]);

  return (
    <ChatMarkdownErrorBoundary fallback={<pre className={styles.mdFallback}>{text}</pre>}>
      <div className={styles.chatMarkdown}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
      </div>
    </ChatMarkdownErrorBoundary>
  );
});
