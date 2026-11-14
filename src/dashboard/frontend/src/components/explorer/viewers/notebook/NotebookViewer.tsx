import { useEffect, useState } from 'react';

import { BinaryCard } from '../shared/BinaryCard';
import { readBounded } from '../shared/readBounded';
import { ViewerLoading } from '../shared/ViewerChrome';
import { openNotebook, type ParsedNotebook } from './notebookParse';
import NotebookPreview from './NotebookPreview';

export default function NotebookViewer(props: {
  readonly src: string;
  readonly name: string;
  readonly size: number;
  readonly downloadUrl: string;
}) {
  const [notebook, setNotebook] = useState<ParsedNotebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetch the notebook JSON and parse it on the main thread (D-4), aborting on unmount or a new source.
  useEffect(() => {
    const controller = new AbortController();
    setNotebook(null);
    setError(null);
    void readBounded(props.src, controller.signal, 8 * 1024 * 1024)
      .then((bytes) => {
        if (controller.signal.aborted) return;
        setNotebook(openNotebook(bytes));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not read this file.');
      });
    return () => controller.abort();
  }, [props.src]);
  if (error)
    return (
      <BinaryCard name={props.name} size={props.size} downloadUrl={props.downloadUrl} notice={error} />
    );
  if (!notebook) return <ViewerLoading />;
  return <NotebookPreview notebook={notebook} sizeBytes={props.size} />;
}
