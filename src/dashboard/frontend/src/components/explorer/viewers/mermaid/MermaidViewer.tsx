// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/MermaidViewer.tsx @ 2d8a843e6b
import { useEffect, useId, useState } from 'react';

import { useTheme } from '../../../../hooks/useTheme';
import { BinaryCard } from '../shared/BinaryCard';
import { ViewerAction, ViewerLoading, ViewerNotice } from '../shared/ViewerChrome';

// Mermaid lays out DOM before sanitizing its SVG. Refuse resource and config
// syntax before that pass so standalone files cannot initiate requests. Node
// metadata is YAML, whose escaped/aliased image keys cannot be checked lexically.
const GUARD =
  /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im;

type State =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'failed'; message: string };

export default function MermaidViewer(props: {
  readonly text: string;
  readonly name: string;
  readonly size: number;
  readonly downloadUrl: string;
}) {
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const rawId = useId();
  const id = `mermaid-${rawId.replaceAll(':', '')}`;
  const [fit, setFit] = useState(true);
  const guarded = GUARD.test(props.text);
  const [state, setState] = useState<State>({ status: 'loading' });
  // Import mermaid dynamically (a separate chunk), render off the main bundle, and ignore results after unmount.
  useEffect(() => {
    if (guarded) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        maxTextSize: 50_000,
      });
      try {
        const { svg } = await mermaid.render(id, props.text);
        if (!cancelled) setState({ status: 'ready', svg });
      } catch (cause) {
        if (!cancelled)
          setState({
            status: 'failed',
            message: cause instanceof Error ? cause.message : 'Could not render this diagram.',
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [guarded, props.text, id, resolvedTheme]);
  if (guarded)
    return (
      <>
        <ViewerNotice>
          This diagram contains resource URLs, markup, node metadata, or custom configuration, so
          it is not rendered.
        </ViewerNotice>
        <div className="min-h-0 flex-1" />
      </>
    );
  if (state.status === 'failed')
    return (
      <BinaryCard
        name={props.name}
        size={props.size}
        downloadUrl={props.downloadUrl}
        notice={state.message}
      />
    );
  if (state.status === 'loading') return <ViewerLoading />;
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}`;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="flex justify-end pb-2">
        <ViewerAction
          label={fit ? 'Show natural size' : 'Fit to width'}
          onClick={() => setFit((value) => !value)}
          pressed={fit}
        />
      </div>
      <img src={src} alt={props.name} className={fit ? 'max-w-full' : undefined} />
    </div>
  );
}
