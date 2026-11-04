import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import {
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  Loader2,
} from 'lucide-react';
import { BROWSERS, EDITORS, type BrowserEntry, type BrowserId, type EditorId, WS_METHODS } from '@overdeck/contracts';
import { toast } from 'sonner';

import { showContextMenu, type ContextMenuFallbackItem } from '../../contextMenuFallback';
import { getMarkdownOpenTarget, getPreferredEditor, setMarkdownOpenTarget, setPreferredEditor } from '../../editorPreferences';
import { cn } from '../../lib/utils';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { ensureSyntaxTheme, highlight, syntaxThemeName } from '../../lib/syntaxTheme';
import { useTheme } from '../../hooks/useTheme';
import { useColorTheme } from '../../hooks/useColorTheme';
import type { MarkdownFileLinkMeta } from '../../markdown-links';
import { useStageDeck } from '../Stage/StageDeckContext';
import { useCitationTarget } from '../../lib/composerCitations';
import { usePickerPosition } from './usePickerPosition';

type FileLinkIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface MarkdownFileLinkProps extends MarkdownFileLinkMeta {
  className?: string;
  issueId?: string | null;
}

interface WorkspaceFilePreviewResult {
  text: string;
  lang: string;
  truncated: boolean;
  totalLines: number;
}

type QuickviewState =
  | { status: 'loading' }
  | { status: 'ready'; html: string; truncated: boolean; totalLines: number }
  | { status: 'error'; message: string };

const FILE_ICON_CLASS_NAME = 'size-3.5 shrink-0 text-muted-foreground';
const QUICKVIEW_CONTEXT_LINES = 12;

const CODE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'go',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'swift',
  'ts',
  'tsx',
  'vue',
]);
const TEXT_EXTENSIONS = new Set(['log', 'md', 'mdx', 'txt']);
const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'rar', 'tar', 'tgz', 'zip']);
const CONFIG_EXTENSIONS = new Set(['env', 'toml', 'yaml', 'yml']);

// PAN-3260 — module-level cache for the right-click menu's external-editor
// list. On fetch failure the cache is cleared (so the next open retries) and
// the menu proceeds with an empty external list rather than blocking.
let sharedAvailableEditorsPromise: Promise<readonly EditorId[]> | null = null;

async function fetchAvailableEditors(): Promise<readonly EditorId[]> {
  try {
    if (!sharedAvailableEditorsPromise) {
      sharedAvailableEditorsPromise = getTransport()
        .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.getAvailableEditors]())
        .then((result) => (result as { editors: readonly EditorId[] }).editors);
    }
    return await sharedAvailableEditorsPromise;
  } catch {
    sharedAvailableEditorsPromise = null;
    return [];
  }
}

// PAN-4762 — module-level cache for the browsers the right-click menu offers,
// same contract as fetchAvailableEditors: clear on failure, show no browsers.
let sharedAvailableBrowsersPromise: Promise<readonly BrowserId[]> | null = null;

async function fetchAvailableBrowsers(): Promise<readonly BrowserId[]> {
  try {
    if (!sharedAvailableBrowsersPromise) {
      sharedAvailableBrowsersPromise = getTransport()
        .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.getAvailableBrowsers]())
        .then((result) => (result as { browsers: readonly BrowserId[] }).browsers);
    }
    return await sharedAvailableBrowsersPromise;
  } catch {
    sharedAvailableBrowsersPromise = null;
    return [];
  }
}

function extensionOfPath(path: string): string {
  const basename = path.replace(/\\/g, '/').split('/').at(-1) ?? '';
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex > 0 ? basename.slice(dotIndex + 1).toLowerCase() : '';
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOfPath(path));
}

// PAN-4762 — file types a browser can render; only these chips get browser items.
const BROWSER_EXTENSIONS = new Set(['avif', 'gif', 'htm', 'html', 'jpeg', 'jpg', 'md', 'pdf', 'png', 'svg', 'txt', 'webp', 'xhtml']);

function isBrowserRenderablePath(path: string): boolean {
  return BROWSER_EXTENSIONS.has(extensionOfPath(path));
}

export function fileLinkIconForPath(path: string): FileLinkIcon {
  const extension = extensionOfPath(path);
  if (extension === 'json') return FileJson;
  if (CODE_EXTENSIONS.has(extension)) return FileCode2;
  if (TEXT_EXTENSIONS.has(extension)) return FileText;
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive;
  if (CONFIG_EXTENSIONS.has(extension)) return FileCog;
  return File;
}

function displayLabel({ displayPath, line, column }: MarkdownFileLinkMeta): string {
  const pathLabel = line ? displayPath.replace(/:\d+(?::\d+)?$/, '') : displayPath;
  const lineLabel = line ? `L${line}${column ? `:C${column}` : ''}` : null;
  return lineLabel ? `${pathLabel} · ${lineLabel}` : pathLabel;
}

async function resolvePreferredEditor(): Promise<EditorId> {
  const result = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getAvailableEditors](),
  );
  const availableEditors = (result as { editors: readonly EditorId[] }).editors;
  const preferred = getPreferredEditor();
  const editor = preferred && availableEditors.includes(preferred)
    ? preferred
    : EDITORS.find((entry) => availableEditors.includes(entry.id))?.id;
  if (!editor) throw new Error('No available editors found.');
  setPreferredEditor(editor);
  return editor;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function highlightQuickviewCode(code: string, lang: string, themeName: string): Promise<string> {
  try {
    return await highlight(code, lang, themeName);
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function relativePathForPreview(displayPath: string): string {
  const pathWithoutPosition = displayPath.replace(/:\d+(?::\d+)?$/, '');
  const normalized = pathWithoutPosition.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

function issueIdFromPath(targetPath: string): string | undefined {
  const normalized = targetPath.replace(/\\/g, '/');
  const match = normalized.match(/\/workspaces\/feature-([a-z]+-\d+)(?:\/|:|$)/i);
  return match?.[1]?.toUpperCase();
}

export const MarkdownFileLink = memo(function MarkdownFileLink({
  filePath,
  targetPath,
  displayPath,
  basename,
  line,
  column,
  className,
  issueId,
}: MarkdownFileLinkProps) {
  const Icon = fileLinkIconForPath(filePath);
  const label = displayLabel({ filePath, targetPath, displayPath, basename, line, column });
  const isMarkdown = isMarkdownPath(filePath);
  const canOpenInBrowser = isBrowserRenderablePath(filePath);
  const deck = useStageDeck();
  const citeTarget = useCitationTarget();
  const containerRef = useRef<HTMLSpanElement>(null);
  const requestIdRef = useRef(0);
  const hoveredRef = useRef(false);
  const [quickviewOpen, setQuickviewOpen] = useState(false);
  const [quickviewState, setQuickviewState] = useState<QuickviewState>({ status: 'loading' });
  const { openUp, align, maxHeight } = usePickerPosition(quickviewOpen, containerRef, {
    estimatedWidth: 520,
    preferredHeight: 360,
  });
  const previewIssueId = issueId ?? issueIdFromPath(targetPath);
  const previewRelativePath = useMemo(() => relativePathForPreview(displayPath), [displayPath]);
  const mode = useTheme((s) => s.resolvedTheme);
  const activeTheme = useColorTheme((s) => s.activeTheme(mode));

  const handleOpen = useCallback(() => {
    void resolvePreferredEditor()
      .then((editor) => getTransport().request((client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({
          cwd: targetPath,
          editor,
        }),
      ))
      .then(() => {
        toast.success('Opened in editor');
      })
      .catch((error) => {
        toast.error(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [targetPath]);

  // PAN-3260 — launches a *specific* external editor (the persisted markdown
  // open target), unlike handleOpen which resolves the general last-used
  // preference and falls back to the first available editor.
  const openWithExternalEditor = useCallback((editor: EditorId) => {
    void getTransport()
      .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({
        cwd: targetPath,
        editor,
      }))
      .then(() => {
        toast.success('Opened in editor');
      })
      .catch((error) => {
        toast.error(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [targetPath]);

  // Opens the folder holding the file with the file selected. Uses filePath,
  // not targetPath: targetPath may end in a `:line[:column]` goto suffix.
  const revealInFileManager = useCallback(() => {
    void getTransport()
      .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({
        cwd: filePath,
        editor: 'file-manager',
        reveal: true,
      }))
      .catch((error) => {
        toast.error(`Failed to open containing folder: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [filePath]);

  // PAN-4762 — opens the file in a browser by its real path (filePath, never
  // the `:line[:column]`-suffixed targetPath).
  const openInBrowser = useCallback((browser: BrowserEntry) => {
    void getTransport()
      .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInBrowser]({
        path: filePath,
        browser: browser.id,
      }))
      .then(() => {
        toast.success(`Opened in ${browser.label}`);
      })
      .catch((error) => {
        toast.error(`Failed to open in browser: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [filePath]);

  const browserMenuItems = useCallback((availableBrowsers: readonly BrowserId[]): ContextMenuFallbackItem[] =>
    BROWSERS.filter((entry) => availableBrowsers.includes(entry.id)).map((entry) => ({
      label: `Open in ${entry.label}`,
      onClick: () => openInBrowser(entry),
    })), [openInBrowser]);

  // PAN-3260 — markdown chips default to the internal editor pane; the
  // persisted overdeck:markdown-open-target preference (set from the
  // right-click menu) can override to a specific external editor. Outside a
  // Stage deck (popouts, ConversationDock, drawers) there is nowhere to open
  // an internal pane, so 'internal' falls back to the external flow.
  const handleMarkdownClick = useCallback(() => {
    const target = getMarkdownOpenTarget();
    if (target === 'internal') {
      if (deck) {
        // PAN-3260 review fix: the internal editor pane reads/writes by the
        // real file path — targetPath may carry a trailing `:line[:column]`
        // suffix for external-editor goto syntax, which would make
        // extname() see e.g. ".md:12" and reject the file as unsupported.
        deck.openOrFocusEditorPane(filePath, basename, citeTarget);
        return;
      }
      handleOpen();
      return;
    }
    openWithExternalEditor(target);
  }, [deck, filePath, basename, citeTarget, handleOpen, openWithExternalEditor]);

  const closeQuickview = useCallback(() => {
    requestIdRef.current++;
    setQuickviewOpen(false);
  }, []);

  const openQuickview = useCallback(() => {
    const activeIssueId = previewIssueId;
    if (!activeIssueId) {
      const message = 'No issue context available for Quickview';
      setQuickviewState({ status: 'error', message });
      setQuickviewOpen(true);
      toast.error(message);
      return;
    }

    const requestId = ++requestIdRef.current;
    setQuickviewState({ status: 'loading' });
    setQuickviewOpen(true);

    void ensureSyntaxTheme(activeTheme).then(() => {
      const themeName = syntaxThemeName(activeTheme);
      return getTransport().request((client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.readWorkspaceFile]({
          issueId: activeIssueId,
          relativePath: previewRelativePath,
          ...(line ? { line } : {}),
          contextLines: QUICKVIEW_CONTEXT_LINES,
        }),
      )
        .then((result) => highlightQuickviewCode(
          (result as WorkspaceFilePreviewResult).text,
          (result as WorkspaceFilePreviewResult).lang,
          themeName,
        ).then((html) => ({ html, result: result as WorkspaceFilePreviewResult })))
        .then(({ html, result }) => {
          if (requestId !== requestIdRef.current) return;
          setQuickviewState({
            status: 'ready',
            html,
            truncated: result.truncated,
            totalLines: result.totalLines,
          });
        });
    })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setQuickviewState({ status: 'error', message });
        toast.error(`Failed to load Quickview: ${message}`);
      });
  }, [line, previewIssueId, previewRelativePath, activeTheme]);

  const copyPath = useCallback((value: string, label: string) => {
    void navigator.clipboard.writeText(value)
      .then(() => {
        toast.success(`Copied ${label}`);
      })
      .catch((error) => {
        toast.error(`Failed to copy ${label}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);

  // PAN-3260 — markdown right-click menu: internal editor, one entry per
  // available external editor, then the existing copy actions. Choosing
  // any open action persists it as the markdown open target so a later
  // left click reuses the choice.
  const openMarkdownContextMenu = useCallback((x: number, y: number) => {
    void Promise.all([
      fetchAvailableEditors(),
      canOpenInBrowser ? fetchAvailableBrowsers() : Promise.resolve<readonly BrowserId[]>([]),
    ]).then(([availableEditors, availableBrowsers]) => {
      const items: ContextMenuFallbackItem[] = [
        {
          label: 'Open in internal editor',
          onClick: () => {
            setMarkdownOpenTarget('internal');
            // PAN-3260 review fix: use filePath, not targetPath — see the
            // matching note in handleMarkdownClick.
            if (deck) deck.openOrFocusEditorPane(filePath, basename, citeTarget);
            else handleOpen();
          },
        },
        ...EDITORS.filter((entry) => availableEditors.includes(entry.id)).map((entry) => ({
          label: `Open in ${entry.label}`,
          onClick: () => {
            setMarkdownOpenTarget(entry.id);
            openWithExternalEditor(entry.id);
          },
        })),
        ...browserMenuItems(availableBrowsers),
        { label: 'Open containing folder', onClick: revealInFileManager },
        { label: 'Copy relative path', onClick: () => copyPath(displayPath, 'relative path') },
        { label: 'Copy full path', onClick: () => copyPath(targetPath, 'full path') },
      ];
      showContextMenu({ x, y, items });
    });
  }, [deck, filePath, targetPath, basename, citeTarget, handleOpen, openWithExternalEditor, revealInFileManager, displayPath, copyPath, canOpenInBrowser, browserMenuItems]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift' && hoveredRef.current && !quickviewOpen) {
        openQuickview();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        closeQuickview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [closeQuickview, openQuickview, quickviewOpen]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex max-w-full align-baseline"
      data-testid="markdown-file-link-container"
      onMouseEnter={(event) => {
        hoveredRef.current = true;
        if (event.shiftKey) openQuickview();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        closeQuickview();
      }}
    >
      <a
        href={targetPath}
        title={targetPath}
        className={cn(
          'chat-markdown-file-link relative top-[2px] inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] leading-5 text-foreground no-underline transition-colors hover:border-primary/50 hover:bg-accent',
          className,
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isMarkdown) {
            handleMarkdownClick();
          } else {
            handleOpen();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isMarkdown) {
            openMarkdownContextMenu(event.clientX, event.clientY);
            return;
          }
          const { clientX: x, clientY: y } = event;
          const showGenericMenu = (availableBrowsers: readonly BrowserId[]) => showContextMenu({
            x,
            y,
            items: [
              { label: 'Open in editor', onClick: handleOpen },
              ...browserMenuItems(availableBrowsers),
              { label: 'Open containing folder', onClick: revealInFileManager },
              { label: 'Copy relative path', onClick: () => copyPath(displayPath, 'relative path') },
              { label: 'Copy full path', onClick: () => copyPath(targetPath, 'full path') },
            ],
          });
          // Only browser-renderable files wait for the browser list; every
          // other chip keeps the synchronous menu.
          if (canOpenInBrowser) void fetchAvailableBrowsers().then(showGenericMenu);
          else showGenericMenu([]);
        }}
      >
        <Icon className={FILE_ICON_CLASS_NAME} aria-hidden="true" data-testid="markdown-file-link-icon" />
        <span className="truncate" data-testid="markdown-file-link-label">{label}</span>
      </a>
      {quickviewOpen && (
        <div
          data-testid="markdown-file-quickview"
          className="absolute z-50 w-[min(520px,calc(100vw-16px))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
          style={{
            maxHeight: `${maxHeight}px`,
            ...(openUp ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
          }}
        >
          {quickviewState.status === 'loading' && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground" data-testid="markdown-file-quickview-loading">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              Loading preview…
            </div>
          )}
          {quickviewState.status === 'error' && (
            <div className="p-3 text-xs text-destructive" data-testid="markdown-file-quickview-error">
              {quickviewState.message}
            </div>
          )}
          {quickviewState.status === 'ready' && (
            <>
              <div
                data-testid="markdown-file-quickview-content"
                className="max-h-[300px] overflow-auto text-xs [&_pre]:m-0 [&_pre]:p-3 [&_pre]:text-xs"
                dangerouslySetInnerHTML={{ __html: quickviewState.html }}
              />
              <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                <span>{line ? `line ${line}` : 'top of file'} · {quickviewState.totalLines} lines</span>
                {quickviewState.truncated && (
                  <span data-testid="markdown-file-quickview-truncated">truncated — first 256 KiB</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
});
