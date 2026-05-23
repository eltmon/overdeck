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
import { EDITORS, type EditorId, WS_METHODS } from '@panctl/contracts';
import { toast } from 'sonner';
import type { DiffsThemeNames } from '@pierre/diffs';

import { showContextMenu } from '../../contextMenuFallback';
import { getPreferredEditor, setPreferredEditor } from '../../editorPreferences';
import { cn } from '../../lib/utils';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import type { MarkdownFileLinkMeta } from '../../markdown-links';
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

let sharedQuickviewHighlighterPromise: Promise<unknown> | null = null;

function extensionOfPath(path: string): string {
  const basename = path.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex > 0 ? basename.slice(dotIndex + 1).toLowerCase() : '';
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
  const availableEditors = (result as { editors: EditorId[] }).editors;
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function highlightQuickviewCode(code: string, lang: string): Promise<string> {
  try {
    if (!sharedQuickviewHighlighterPromise) {
      sharedQuickviewHighlighterPromise = import('@pierre/diffs').then((m) =>
        m.getSharedHighlighter({ themes: ['github-dark' as DiffsThemeNames], langs: [] }),
      );
    }
    const highlighter = await sharedQuickviewHighlighterPromise as {
      codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
    };
    return highlighter.codeToHtml(code, { lang: lang || 'text', theme: 'github-light' });
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function relativePathForPreview(displayPath: string): string {
  const pathWithoutPosition = displayPath.replace(/:\d+(?::\d+)?$/, '');
  const normalized = pathWithoutPosition.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

function issueIdFromPath(targetPath: string): string | undefined {
  const normalized = targetPath.replaceAll('\\', '/');
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

    void getTransport().request((client) =>
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
      ).then((html) => ({ html, result: result as WorkspaceFilePreviewResult })))
      .then(({ html, result }) => {
        if (requestId !== requestIdRef.current) return;
        setQuickviewState({
          status: 'ready',
          html,
          truncated: result.truncated,
          totalLines: result.totalLines,
        });
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setQuickviewState({ status: 'error', message });
        toast.error(`Failed to load Quickview: ${message}`);
      });
  }, [line, previewIssueId, previewRelativePath]);

  const copyPath = useCallback((value: string, label: string) => {
    void navigator.clipboard.writeText(value)
      .then(() => {
        toast.success(`Copied ${label}`);
      })
      .catch((error) => {
        toast.error(`Failed to copy ${label}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);

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
          handleOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              { label: 'Open in editor', onClick: handleOpen },
              { label: 'Copy relative path', onClick: () => copyPath(displayPath, 'relative path') },
              { label: 'Copy full path', onClick: () => copyPath(targetPath, 'full path') },
            ],
          });
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
