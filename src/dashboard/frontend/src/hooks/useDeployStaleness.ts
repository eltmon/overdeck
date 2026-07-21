import {
  DeployStalenessSnapshot as DeployStalenessSnapshotSchema,
  type DeployStalenessSnapshot,
} from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { Effect, Schema } from 'effect';

async function fetchDeployStaleness(): Promise<DeployStalenessSnapshot | null> {
  const response = await fetch('/api/deploy/staleness');
  if (!response.ok) throw new Error('Failed to fetch deploy staleness');
  const payload: unknown = await response.json();
  return Effect.runPromise(
    Schema.decodeUnknownEffect(
      Schema.NullOr(DeployStalenessSnapshotSchema),
    )(payload),
  );
}

export function useDeployStaleness() {
  return useQuery<DeployStalenessSnapshot | null>({
    queryKey: ['deploy-staleness'],
    queryFn: fetchDeployStaleness,
    refetchInterval: 60_000,
  });
}
