import { useState, useEffect } from 'react';
import type { SessionNode } from '@panctl/contracts';

let resolvedModelsCache: Record<string, string | null> | null = null;
let resolvedModelsFetchPromise: Promise<Record<string, string | null>> | null = null;

export function useResolvedModels(): Record<string, string | null> {
  const [models, setModels] = useState<Record<string, string | null>>(resolvedModelsCache ?? {});

  useEffect(() => {
    if (resolvedModelsCache) {
      setModels(resolvedModelsCache);
      return;
    }
    if (!resolvedModelsFetchPromise) {
      resolvedModelsFetchPromise = fetch('/api/models/resolve')
        .then(r => r.json())
        .then((data: Record<string, string | null>) => {
          resolvedModelsCache = data;
          return data;
        })
        .catch(() => ({}));
    }
    resolvedModelsFetchPromise.then(data => setModels(data)).catch(() => {});
  }, []);

  return models;
}

export function resolveWorkTypeKey(session: Pick<SessionNode, 'type' | 'role'>): string | null {
  return session.type === 'review' ? 'role:review'
    : session.type === 'reviewer' && session.role ? `role:review.${session.role}`
    : session.type === 'work' ? 'role:work'
    : session.type === 'planning' ? 'role:plan'
    : session.type === 'test' ? 'role:test'
    : session.type === 'ship' || session.type === 'merge' ? 'role:ship'
    : null;
}
