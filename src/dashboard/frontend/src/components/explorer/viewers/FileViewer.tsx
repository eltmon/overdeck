/**
 * Viewer host (PAN-5188 §6.7). The one component a code pane renders for a
 * non-text file: it picks the viewer with pickViewer and lazy-loads it, so the
 * viewer chunks (pdf.js, sql.js, jszip, tiff, mermaid, the betteroffice
 * engines) load only when one renders. Bytes come from the download route;
 * `rev` (the read signature) busts the cache when the file changes, and the
 * root is keyed on it so a changed file remounts the viewer.
 */
import { lazy, Suspense } from 'react';
import type { ExplorerReadFileResult } from '@overdeck/contracts';

import { explorerDownloadUrl } from '../explorer-http';
import { BinaryCard } from './shared/BinaryCard';
import { ViewerLoading } from './shared/ViewerChrome';
import { officeKindOf, pickViewer } from './viewer-router';

const ImageViewer = lazy(() => import('./image/ImageViewer'));
const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
const AudioViewer = lazy(() => import('./audio/AudioViewer'));
const FontViewer = lazy(() => import('./font/FontViewer'));
const LargeTextViewer = lazy(() => import('./large-text/LargeTextViewer'));
const DelimitedTablePreview = lazy(() =>
  import('./large-text/DelimitedTablePreview').then((module) => ({ default: module.DelimitedTablePreview })),
);
const BinaryViewer = lazy(() => import('./binary/BinaryViewer'));
const OpenXmlOfficeViewer = lazy(() => import('./office/OpenXmlOfficeViewer'));
const OdfViewer = lazy(() => import('./office/OdfViewer'));
const NotebookViewer = lazy(() => import('./notebook/NotebookViewer'));
const MermaidViewer = lazy(() => import('./mermaid/MermaidViewer'));

export interface FileViewerProps {
  rootId: string;
  /** Root-relative POSIX path. */
  path: string;
  read: ExplorerReadFileResult;
  /** Large-text viewer line wrapping; default true. */
  wordWrap?: boolean;
}

export default function FileViewer({ rootId, path, read, wordWrap = true }: FileViewerProps) {
  const choice = pickViewer(path, read);
  if (choice.kind === 'text') return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const src = explorerDownloadUrl(rootId, path, { inline: true, rev: read.signature });
  const downloadUrl = explorerDownloadUrl(rootId, path, { inline: false });

  const viewer = (() => {
    switch (choice.kind) {
      case 'image':
      case 'svg':
        return <ImageViewer src={src} name={name} size={read.size} downloadUrl={downloadUrl} svg={choice.kind === 'svg'} />;
      case 'pdf':
        return <PdfViewer src={src} title={name} />;
      case 'audio':
        return <AudioViewer src={src} name={name} size={read.size} />;
      case 'font':
        return <FontViewer src={src} name={name} />;
      case 'table':
        return <DelimitedTablePreview name={name} text={read.text ?? ''} delimiter={choice.delimiter ?? ','} />;
      case 'large-text':
        return <LargeTextViewer name={name} src={src} sizeBytes={read.size} delimiter={choice.delimiter} wordWrap={wordWrap} />;
      case 'archive':
      case 'sqlite':
        return <BinaryViewer src={src} name={name} kind={choice.kind} />;
      case 'office': {
        const kind = officeKindOf(path);
        if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx')
          return <OpenXmlOfficeViewer src={src} name={name} kind={kind} size={read.size} downloadUrl={downloadUrl} />;
        if (kind) return <OdfViewer src={src} name={name} kind={kind} size={read.size} downloadUrl={downloadUrl} />;
        return <BinaryCard name={name} size={read.size} downloadUrl={downloadUrl} />;
      }
      case 'notebook':
        return <NotebookViewer src={src} name={name} size={read.size} downloadUrl={downloadUrl} />;
      case 'mermaid':
        return <MermaidViewer text={read.text ?? ''} name={name} size={read.size} downloadUrl={downloadUrl} />;
      case 'binary':
        return <BinaryCard name={name} size={read.size} downloadUrl={downloadUrl} />;
    }
  })();

  return (
    <div key={read.signature} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Suspense fallback={<ViewerLoading />}>{viewer}</Suspense>
    </div>
  );
}
