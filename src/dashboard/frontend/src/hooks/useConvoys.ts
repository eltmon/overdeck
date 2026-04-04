import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ConvoyAgentState {
  role: string;
  subagent: string;
  tmuxSession: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  outputFile?: string;
  exitCode?: number;
}

export interface ConvoyState {
  id: string;
  template: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  agents: ConvoyAgentState[];
  startedAt: string;
  completedAt?: string;
  outputDir: string;
  context: {
    projectPath: string;
    files?: string[];
    prUrl?: string;
    issueId?: string;
    [key: string]: any;
  };
}

export interface ConvoyContext {
  projectPath: string;
  files?: string[];
  prUrl?: string;
  issueId?: string;
  [key: string]: any;
}

async function fetchConvoys(): Promise<ConvoyState[]> {
  const res = await fetch('/api/convoys');
  if (!res.ok) throw new Error('Failed to fetch convoys');
  const data = await res.json();
  return data.convoys;
}

async function fetchConvoyStatus(convoyId: string): Promise<ConvoyState> {
  const res = await fetch(`/api/convoys/${convoyId}`);
  if (!res.ok) throw new Error('Failed to fetch convoy status');
  return res.json();
}

async function startConvoy(template: string, context: ConvoyContext): Promise<ConvoyState> {
  const res = await fetch('/api/convoys/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template, context }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to start convoy');
  }
  return res.json();
}

async function stopConvoy(convoyId: string): Promise<void> {
  const res = await fetch(`/api/convoys/${convoyId}/stop`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to stop convoy');
  }
}

async function fetchConvoyOutput(convoyId: string): Promise<Record<string, string>> {
  const res = await fetch(`/api/convoys/${convoyId}/output`);
  if (!res.ok) throw new Error('Failed to fetch convoy output');
  const data = await res.json();
  return data.outputs;
}

export function useConvoys() {
  return useQuery({
    queryKey: ['convoys'],
    queryFn: fetchConvoys,
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });
}

export function useConvoyStatus(convoyId: string | undefined) {
  return useQuery({
    queryKey: ['convoy', convoyId],
    queryFn: () => fetchConvoyStatus(convoyId!),
    enabled: !!convoyId,
    refetchInterval: 2000, // Refresh every 2 seconds for active convoy
  });
}

export function useConvoyOutput(convoyId: string | undefined) {
  return useQuery({
    queryKey: ['convoy-output', convoyId],
    queryFn: () => fetchConvoyOutput(convoyId!),
    enabled: !!convoyId,
    refetchInterval: 5000,
  });
}

export function useStartConvoy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ template, context }: { template: string; context: ConvoyContext }) =>
      startConvoy(template, context),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['convoys'] });
    },
  });
}

export function useStopConvoy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (convoyId: string) => stopConvoy(convoyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['convoys'] });
    },
  });
}
