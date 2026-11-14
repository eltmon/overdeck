// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/OfficeViewer.tsx @ 2d8a843e6b
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import VirtualTablePreview from '../large-text/VirtualTablePreview';
import { BinaryCard } from '../shared/BinaryCard';
import { formatSize } from '../shared/formatSize';
import { ViewerAction, ViewerLoading, ViewerNotice } from '../shared/ViewerChrome';
import { OFFICE_PREVIEW_MAX_BYTES, type OfficeWorkerResult } from './officePreviewProtocol';

const DocumentPages = lazy(() => import('./DocumentPages'));

type Workbook = Extract<OfficeWorkerResult, { type: 'ods' }>;

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

export default function OdfViewer(props: {
  readonly src: string;
  readonly name: string;
  readonly kind: 'odt' | 'ods' | 'odp';
  readonly size: number;
  readonly downloadUrl: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sheetPages, setSheetPages] = useState(new Map<string, string[][]>());
  const pendingPages = useRef(new Set<string>());
  const [previewDocument, setDocument] = useState<Extract<
    OfficeWorkerResult,
    { type: 'document' }
  > | null>(null);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [count, setCount] = useState(0);
  const [fileSize, setFileSize] = useState(props.size);
  const [page, setPage] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Own the Office fetch, preparation worker, and timeout for this source and release them on cleanup.
  useEffect(() => {
    const controller = new AbortController();
    if (props.size > OFFICE_PREVIEW_MAX_BYTES) {
      setError('Preview limited to files under 50 MB.');
      return;
    }
    const worker = new Worker(new URL('./officePreview.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const fail = (message: string) => {
      if (!controller.signal.aborted) setError(message);
      controller.abort();
      worker.terminate();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    timerRef.current = setTimeout(
      () => fail('This document took too long to preview.'),
      30_000,
    );
    worker.addEventListener('error', () =>
      fail('Could not load the Office viewer. Close the file and try again.'),
    );
    worker.addEventListener('message', (event: MessageEvent<OfficeWorkerResult>) => {
      if (controller.signal.aborted) return;
      const result = event.data;
      if (result.type === 'error') fail(result.message);
      else if (result.type === 'document') {
        if (timerRef.current) clearTimeout(timerRef.current);
        setDocument(result);
        setCount(result.pages.length > 1 ? result.pages.length : 0);
      } else if (result.type === 'ods') {
        if (timerRef.current) clearTimeout(timerRef.current);
        setWorkbook(result);
        setCount(result.sheets.length);
      } else if (result.type === 'sheet-page') {
        const key = `${result.sheet}:${result.index}`;
        pendingPages.current.delete(key);
        setSheetPages((old) => {
          const next = new Map(old);
          next.set(key, result.rows);
          if (next.size > 12) next.delete(next.keys().next().value!);
          return next;
        });
      }
    });
    void readOfficeFile(props.src, controller.signal)
      .then((bytes) => {
        if (!controller.signal.aborted) {
          setFileSize(bytes.byteLength);
          worker.postMessage({ type: 'open', kind: props.kind, bytes }, [bytes]);
        }
      })
      .catch((cause: unknown) =>
        fail(cause instanceof Error ? cause.message : 'Could not read this file.'),
      );
    return () => {
      controller.abort();
      worker.terminate();
      workerRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [props.src, props.kind, props.size]);
  const selectPage = setPage;
  if (error)
    return (
      <BinaryCard name={props.name} size={fileSize} downloadUrl={props.downloadUrl} notice={error} />
    );
  const sheet = workbook?.sheets[page];
  const documentPage = previewDocument?.pages[page];
  const navigation = workbook ? 'sheet' : (previewDocument?.navigation ?? 'slide');
  const documentCount = previewDocument?.pages.length ?? 0;
  const documentDetails =
    navigation === 'chapter'
      ? `Chapter ${page + 1} of ${documentCount}`
      : `${documentCount} ${navigation}${documentCount === 1 ? '' : 's'}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {count > 0 ? (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
          <ViewerAction
            label={`Previous ${navigation}`}
            disabled={page === 0}
            onClick={() => selectPage(page - 1)}
            icon={<ChevronLeftIcon className="size-3.5" />}
          />
          {workbook ? (
            <div className="min-w-0 flex-1">
              <select
                aria-label="Sheet"
                value={page}
                onChange={(event) => selectPage(Number(event.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                {workbook.sheets.map((item, index) => (
                  <option key={index} value={index}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : previewDocument?.navigation === 'chapter' ? (
            <div className="min-w-0 flex-1">
              <select
                aria-label="Chapter"
                value={page}
                onChange={(event) => selectPage(Number(event.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                {previewDocument.pages.map((item, index) => (
                  <option key={index} value={index}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="flex-1 text-center tabular-nums" aria-live="polite">
              {navigation === 'slide' ? 'Slide' : 'Page'} {page + 1} of {count}
            </span>
          )}
          <ViewerAction
            label={`Next ${navigation}`}
            disabled={page + 1 === count}
            onClick={() => selectPage(page + 1)}
            icon={<ChevronRightIcon className="size-3.5" />}
          />
        </div>
      ) : null}
      {props.kind === 'ods' && sheet ? (
        <div
          className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-1 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground tabular-nums"
          role="status"
        >
          Sheet {page + 1} of {count} · {sheet.rowCount.toLocaleString()} row
          {sheet.rowCount === 1 ? '' : 's'} · {sheet.columns.toLocaleString()} column
          {sheet.columns === 1 ? '' : 's'}
          {fileSize !== undefined ? ` · ${fileSize === 0 ? '0 bytes' : formatSize(fileSize)}` : ''}
        </div>
      ) : null}
      {documentPage ? (
        <>
          <ViewerNotice>
            Text and images. Layout and embedded objects may differ from the original.
          </ViewerNotice>
          <Suspense fallback={<ViewerLoading />}>
            <DocumentPages
              html={documentPage.html}
              name={`${props.name}: ${documentPage.title}`}
              details={`${documentDetails}${fileSize !== undefined ? ` · ${fileSize === 0 ? '0 bytes' : formatSize(fileSize)}` : ''}`}
            />
          </Suspense>
        </>
      ) : sheet ? (
        <>
          <ViewerNotice>
            Cell values only. Charts, images, and formatting are not shown.
            {sheet.truncated
              ? props.kind === 'ods'
                ? ' Limited to 500 rows and 50 columns.'
                : ' Preview limited to 250,000 rows, 1,024 columns, and bounded cell text.'
              : ''}
          </ViewerNotice>
          {sheet.rowCount === 0 ? (
            <p className="p-6 text-xs text-muted-foreground">This sheet is empty.</p>
          ) : (
            <VirtualTablePreview
              key={page}
              name={`${props.name}: ${sheet.name}`}
              count={sheet.rowCount}
              columns={sheet.columns}
              getRows={(index) => (index === 0 ? sheet.rows : sheetPages.get(`${page}:${index}`))}
              loadPage={(index) => {
                const key = `${page}:${index}`;
                if (pendingPages.current.has(key)) return;
                pendingPages.current.add(key);
                workerRef.current?.postMessage({ type: 'sheet-page', sheet: page, index });
              }}
            />
          )}
        </>
      ) : (
        <ViewerLoading />
      )}
    </div>
  );
}
