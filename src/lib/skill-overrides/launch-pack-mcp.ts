/**
 * Pack MCP servers for one launch (PAN-5165). A selected, consented claude-plugin pack contributes its
 * applied https servers; names already taken by overdeck, the role, the project or a lower pack id are
 * skipped with one warning each. Reads only the pack cache and config; never throws.
 */
import type { PackMcpServer } from '../skill-packs/adapters.js';
import { ATLASSIAN_PACK_ID, withAtlassianAuth } from '../skill-packs/atlassian.js';
import { resolveLaunchPackSelection } from './launch.js';

export async function resolveLaunchPackMcpServers(input: {
  cwd: string;
  issueId?: string;
  conversation?: string;
  reservedNames: readonly string[];
  warn?: (line: string) => void;
}): Promise<Record<string, PackMcpServer>> {
  const warn = input.warn ?? console.warn;
  try {
    const { mcp } = await resolveLaunchPackSelection({
      cwd: input.cwd,
      issueId: input.issueId,
      conversation: input.conversation,
    });
    const reserved = new Set(input.reservedNames);
    const takenBy = new Map<string, string>();
    const servers: Record<string, PackMcpServer> = {};
    for (const pack of mcp) {
      if (!pack.consented) {
        warn(`[pack-mcp] ${pack.packId}: MCP servers not applied: run pan skills pack update ${pack.packId} to review them`);
        continue;
      }
      let packServers = pack.servers;
      if (pack.packId === ATLASSIAN_PACK_ID) {
        try {
          const { loadConfigNoMigration } = await import('../config-yaml.js');
          packServers = withAtlassianAuth(pack.servers, (await loadConfigNoMigration()).config.trackerKeys);
        } catch (error) {
          // A tracker-key read failure drops only the auth header, never this pack's servers or any other pack's.
          warn(`[pack-mcp] atlassian: tracker keys unavailable, server applied without the Jira header: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const [name, server] of Object.entries(packServers)) {
        if (reserved.has(name)) {
          warn(`[pack-mcp] ${pack.packId}: server ${name} skipped: the name is already used by overdeck, the role or the project`);
          continue;
        }
        const earlier = takenBy.get(name);
        if (earlier) {
          warn(`[pack-mcp] ${pack.packId}: server ${name} skipped: pack ${earlier} already declares it`);
          continue;
        }
        takenBy.set(name, pack.packId);
        servers[name] = { ...server, headers: { ...server.headers } };
      }
    }
    return servers;
  } catch (error) {
    warn(`[pack-mcp] pack MCP servers skipped: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}
