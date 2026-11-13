// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/OpenXmlOfficeViewer.tsx @ 2d8a843e6b
import { lazy, Suspense, useEffect, useState } from 'react';

import { BinaryCard } from '../shared/BinaryCard';
import { useLatestCallback } from '../shared/useLatestCallback';
import { ViewerLoading, ViewerNotice } from '../shared/ViewerChrome';
import { OFFICE_PREVIEW_MAX_BYTES, type OfficeWorkerResult } from './officePreviewProtocol';

const WordDocument = lazy(() => import('./engine/WordDocument'));
const Spreadsheet = lazy(() => import('./engine/Spreadsheet'));
const Presentation = lazy(() => import('./engine/Presentation'));

async function readOfficeFile(src: string, signal: AbortSignal) {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error('The file could not be loaded. Close it and try again.');
  if (Number(response.headers.get('content-length')) > OFFICE_PREVIEW_MAX_BYTES)
    throw new Error('Preview limited to files under 50 MB.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The file is unavailable.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > OFFICE_PREVIEW_MAX_BYTES) throw new Error('Preview limited to files under 50 MB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks).arrayBuffer();
}

export default function OpenXmlOfficeViewer(props: {
  readonly src: string;
  readonly name: string;
  readonly kind: 'docx' | 'xlsx' | 'pptx';
  readonly size: number;
  readonly downloadUrl: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Extract<OfficeWorkerResult, { bytes: ArrayBuffer }>>();
  const [details, setDetails] = useState('');
  const fail = useLatestCallback((cause: unknown) =>
    setError(cause instanceof Error ? cause.message : 'Could not render this Office document.'),
  );
  // Own the Open XML fetch, preparation worker, and timeout for this source and release them on cleanup.
  useEffect(() => {
    if (props.size > OFFICE_PREVIEW_MAX_BYTES) {
      // Metadata bounds are checked before fetching or starting an engine.
      setError('Preview limited to files under 50 MB.');
      return;
    }
    const controller = new AbortController();
    const worker = new Worker(new URL('./officePreview.worker.ts', import.meta.url), {
      type: 'module',
    });
    const failure = (cause: unknown) => {
      if (!controller.signal.aborted) fail(cause);
      controller.abort();
      worker.terminate();
    };
    const timer = setTimeout(
      () => failure(new Error('This document took too long to preview.')),
      30000,
    );
    worker.addEventListener('error', () => failure(new Error('Could not load the Office viewer.')));
    worker.addEventListener('messageerror', () =>
      failure(new Error('Could not read the Office viewer response.')),
    );
    worker.addEventListener('message', (event: MessageEvent<OfficeWorkerResult>) => {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      if (event.data.type === 'error') failure(new Error(event.data.message));
      else if ('bytes' in event.data) {
        setPrepared(event.data);
        worker.terminate();
      }
    });
    void readOfficeFile(props.src, controller.signal)
      .then((bytes) => {
        if (!controller.signal.aborted)
          worker.postMessage({ type: 'open', kind: props.kind, bytes }, [bytes]);
      })
      .catch(failure);
    return () => {
      controller.abort();
      worker.terminate();
      clearTimeout(timer);
    };
  }, [props.src, props.kind, props.size, fail]);
  if (error)
    return (
      <BinaryCard name={props.name} size={props.size} downloadUrl={props.downloadUrl} notice={error} />
    );
  if (!prepared) return <ViewerLoading />;
  const Viewer = props.kind === 'docx' ? WordDocument : Presentation;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {details ? (
        <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-3 py-1 text-xs text-muted-foreground">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {details}
            {props.kind !== 'xlsx' ? ' · Fit to width' : ''}
          </span>
        </div>
      ) : null}
      {prepared.truncated ? (
        <ViewerNotice>Preview limited. Download the file to read all of it.</ViewerNotice>
      ) : null}
      <Suspense fallback={<ViewerLoading />}>
        {prepared.view ? (
          <Spreadsheet
            bytes={prepared.bytes}
            view={prepared.view}
            onDetails={setDetails}
            onError={fail}
          />
        ) : (
          <Viewer bytes={prepared.bytes} onDetails={setDetails} onError={fail} />
        )}
      </Suspense>
    </div>
  );
}
