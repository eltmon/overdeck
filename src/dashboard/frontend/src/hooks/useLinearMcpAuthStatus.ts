import { useQuery } from '@tanstack/react-query';

export interface LinearMcpAuthBlockedAgent {
  agentId: string;
  issueId: string | null;
  declaredAt: string;
  expiresAt: string;
  notifiedAt: string | null;
  /** Canonical tracker URL projected by the server (Linear web URL, GitHub
   * html_url); null when the issue cannot be resolved. */
  issueUrl?: string | null;
  /** Canonical /conv/<rowid> dashboard URL projected by the server from the
   * conversations read door; null for non-conversation agents or when the
   * conversation cannot be resolved. */
  conversationUrl?: string | null;
}

export interface LinearMcpAuthStatus {
  status: 'none' | 'active' | 'expired';
  authUrl: string | null;
  authUrlAgentId: string | null;
  authUrlExpiresAt: string | null;
  declaredAt: string | null;
  blockedAgents: LinearMcpAuthBlockedAgent[];
}

export async function fetchLinearMcpAuthStatus(): Promise<LinearMcpAuthStatus> {
  const res = await fetch('/api/linear-mcp-auth');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Linear MCP auth status (${res.status}): ${body}`);
  }
  return res.json();
}

export function useLinearMcpAuthStatus() {
  return useQuery<LinearMcpAuthStatus>({
    queryKey: ['linear-mcp-auth'],
    queryFn: fetchLinearMcpAuthStatus,
    // Poll fast while an intervention is on screen so state changes (expired
    // link, new blocked agent, cleared banner) show up promptly; back off
    // when there is nothing to act on. Same active/idle shape as the codex
    // auth pollers.
    refetchInterval: (query) => (query.state.data?.status === 'none' ? 30_000 : 5_000),
  });
}
