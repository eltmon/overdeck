import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoPresoControls } from './AutoPresoControls';
import { TranscriptPanel } from './TranscriptPanel';
import { useAutoPresoWebSocket, type ExcalidrawElementLike } from '../../hooks/useAutoPresoWebSocket';
import '@excalidraw/excalidraw/index.css';

type ExcalidrawApiLike = any;

const Excalidraw = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw');
  return { default: mod.Excalidraw };
});

export function AutoPresoView() {
  const {
    elements: serverElements,
    mode,
    warmupStatus,
    partialText,
    committedTurns,
    isListening,
    startListening,
    stopListening,
  } = useAutoPresoWebSocket();
  const [stagingElements, setStagingElements] = useState<readonly ExcalidrawElementLike[]>([]);
  const excalidrawApiRef = useRef<ExcalidrawApiLike | null>(null);
  const elements = mode === 'live' ? serverElements : stagingElements;
  const initialData = useMemo(() => ({ elements: elements as readonly never[] }), [elements]);

  const handleStart = useCallback(async () => {
    await fetch('/api/autopreso/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: stagingElements, screenshotBase64: null }),
    });
  }, [stagingElements]);

  const handleBackToStaging = useCallback(async () => {
    await fetch('/api/autopreso/back-to-staging', { method: 'POST' });
  }, []);

  const handleReset = useCallback(async () => {
    await fetch('/api/autopreso/session/reset', { method: 'POST' });
    setStagingElements([]);
    excalidrawApiRef.current?.updateScene?.({ elements: [] });
  }, []);

  const handleToggleMic = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleChange = useCallback((nextElements: readonly ExcalidrawElementLike[]) => {
    if (mode === 'staging') setStagingElements(nextElements);
  }, [mode]);

  const handleApi = useCallback((api: ExcalidrawApiLike) => {
    excalidrawApiRef.current = api;
  }, []);

  useEffect(() => {
    if (mode === 'live') {
      excalidrawApiRef.current?.updateScene?.({ elements: serverElements });
    }
  }, [mode, serverElements]);

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden bg-background p-4 text-foreground">
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading whiteboard…</div>}>
          <Excalidraw
            key={mode}
            excalidrawAPI={handleApi}
            initialData={initialData}
            onChange={handleChange}
            viewModeEnabled={mode === 'live'}
          />
        </Suspense>
      </div>

      <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto">
        <AutoPresoControls
          mode={mode}
          warmupStatus={warmupStatus}
          isListening={isListening}
          onStart={handleStart}
          onBackToStaging={handleBackToStaging}
          onReset={handleReset}
          onToggleMic={handleToggleMic}
        />
        <TranscriptPanel
          turns={committedTurns}
          partialText={partialText}
        />
      </aside>
    </div>
  );
}
