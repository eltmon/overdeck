/** Audio viewer (PAN-5188 FR-14, D-10): the browser's own player, written fresh. */
import { useState } from 'react';

import { formatSize } from '../shared/formatSize';
import { ViewerFailure } from '../shared/ViewerChrome';

export const AUDIO_FAILURE = 'This browser cannot play this audio file.';

export default function AudioViewer({ src, name, size }: { src: string; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ViewerFailure message={AUDIO_FAILURE} />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground">{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatSize(size)}</p>
        </div>
        <audio controls preload="metadata" src={src} className="w-full" onError={() => setFailed(true)} />
      </div>
    </div>
  );
}
