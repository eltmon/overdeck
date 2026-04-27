import { useQuery } from '@tanstack/react-query';
import type { SystemHealthSnapshot } from '../types';

export async function fetchSystemHealth(): Promise<SystemHealthSnapshot> {
  const res = await fetch('/api/system/health');
  if (!res.ok) throw new Error('Failed to fetch system health');
  return res.json();
}

export function useSystemHealth() {
  return useQuery<SystemHealthSnapshot>({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 10000,
  });
}
