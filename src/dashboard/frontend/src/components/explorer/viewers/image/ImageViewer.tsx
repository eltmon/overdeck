/**
 * Image viewer (PAN-5188 FR-12, D-10). Written fresh: a plain <img> with a
 * Fit / 100 % toggle. SVG is read as text and shown through a data: URL, so it
 * never runs as a document. A TIFF the browser cannot show is decoded to PNG in
 * a worker; a HEIC/HEIF it cannot show falls back to the binary card (D-2).
 */
import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { BinaryCard } from '../shared/BinaryCard';
import { readBounded } from '../shared/readBounded';
import { ViewerAction, ViewerFailure, ViewerLoading } from '../shared/ViewerChrome';
import { decodeImagePreview } from './decodeImagePreview';

const SVG_MAX_BYTES = 10 * 1024 * 1024;
export const HEIC_NOTICE = 'This browser cannot show HEIC images.';

export interface ImageViewerProps {
  src: string;
  name: string;
  size: number;
  downloadUrl: string;
  svg?: boolean;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

type Display =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'heic' }
  | { kind: 'failed'; message: string };

export default function ImageViewer({ src, name, size, downloadUrl, svg = false }: ImageViewerProps) {
  const [display, setDisplay] = useState<Display>(svg ? { kind: 'loading' } : { kind: 'image', url: src });
  const [actualSize, setActualSize] = useState(false);
  const [decodeRequest, setDecodeRequest] = useState(0);

  // SVG: read the text (bounded) and show it as a passive data: URL. Other
  // formats show src directly, and a new src starts over.
  useEffect(() => {
    if (!svg) {
      setDisplay({ kind: 'image', url: src });
      return;
    }
    const controller = new AbortController();
    setDisplay({ kind: 'loading' });
    readBounded(src, controller.signal, SVG_MAX_BYTES)
      .then((bytes) => {
        const text = new TextDecoder().decode(bytes);
        if (!controller.signal.aborted) setDisplay({ kind: 'image', url: `data:image/svg+xml;base64,${base64Utf8(text)}` });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setDisplay({ kind: 'failed', message: cause instanceof Error ? cause.message : 'Could not load this image.' });
      });
    return () => controller.abort();
  }, [src, svg]);

  // TIFF the browser could not show: decode it to PNG in a worker.
  useEffect(() => {
    if (decodeRequest === 0) return;
    const controller = new AbortController();
    let url: string | null = null;
    setDisplay({ kind: 'loading' });
    decodeImagePreview(src, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setDisplay({ kind: 'image', url });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setDisplay({ kind: 'failed', message: cause instanceof Error ? cause.message : 'Could not decode this image.' });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [decodeRequest, src]);

  const onError = () => {
    if (display.kind !== 'image') return;
    const ext = extensionOf(name);
    if ((ext === 'tif' || ext === 'tiff') && decodeRequest === 0) setDecodeRequest(1);
    else if (ext === 'heic' || ext === 'heif') setDisplay({ kind: 'heic' });
    else setDisplay({ kind: 'failed', message: 'This browser cannot show this image.' });
  };

  if (display.kind === 'heic') return <BinaryCard name={name} size={size} downloadUrl={downloadUrl} notice={HEIC_NOTICE} />;
  if (display.kind === 'failed') return <ViewerFailure message={display.message} />;
  if (display.kind === 'loading') return <ViewerLoading label="Loading image" />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <span className="mr-auto truncate px-1 font-mono text-muted-foreground">{name}</span>
        <ViewerAction
          label={actualSize ? 'Fit to pane' : 'Actual size'}
          pressed={actualSize}
          onClick={() => setActualSize((value) => !value)}
          icon={actualSize ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        />
      </div>
      <div className={`min-h-0 flex-1 bg-muted ${actualSize ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden p-4'}`}>
        <img
          src={display.url}
          alt={name}
          onError={onError}
          className={actualSize ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
        />
      </div>
    </div>
  );
}
