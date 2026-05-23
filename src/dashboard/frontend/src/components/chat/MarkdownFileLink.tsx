import { memo, useCallback, type ComponentType, type SVGProps } from 'react';
import {
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileText,
} from 'lucide-react';
import { EDITORS, type EditorId, WS_METHODS } from '@panctl/contracts';
import { toast } from 'sonner';

import { getPreferredEditor, setPreferredEditor } from '../../editorPreferences';
import { cn } from '../../lib/utils';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import type { MarkdownFileLinkMeta } from '../../markdown-links';

type FileLinkIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface MarkdownFileLinkProps extends MarkdownFileLinkMeta {
  className?: string;
}

const FILE_ICON_CLASS_NAME = 'size-3.5 shrink-0 text-muted-foreground';

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

export const MarkdownFileLink = memo(function MarkdownFileLink({
  filePath,
  targetPath,
  displayPath,
  basename,
  line,
  column,
  className,
}: MarkdownFileLinkProps) {
  const Icon = fileLinkIconForPath(filePath);
  const label = displayLabel({ filePath, targetPath, displayPath, basename, line, column });

  const handleOpen = useCallback(() => {
    void resolvePreferredEditor()
      .then((editor) => getTransport().request((client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({
          cwd: targetPath,
          editor,
        }),
      ))
      .catch((error) => {
        toast.error(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [targetPath]);

  return (
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
    >
      <Icon className={FILE_ICON_CLASS_NAME} aria-hidden="true" data-testid="markdown-file-link-icon" />
      <span className="truncate" data-testid="markdown-file-link-label">{label}</span>
    </a>
  );
});
