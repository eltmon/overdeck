import { messageThreadId, type AppServerMessage, type ThreadScope } from './app-server-manager.js';

type JsonRecord = Record<string, unknown>;

/**
 * Follows the owner tree's `spawnAgent` calls for the app-server host
 * (PAN-4031): which calls are still open, and the model each sub-agent runs
 * on.
 *
 * - The spawn item carries the model requested for the new thread. A
 *   `thread/settings/updated` for the sub-agent overrides it. A spawn that
 *   names no model takes its spawner's model as it is at spawn time.
 * - An open call (`item/started` seen, `item/completed` not yet) means a
 *   sub-agent may be sending status before its spawn item adopts it. The
 *   owner's `turn/completed` closes any call whose completion never arrived.
 */
export class SubAgentSpawns {
  private readonly open = new Set<string>();
  private readonly models = new Map<string, string>();

  constructor(
    private readonly scopeOf: (threadId: string) => ThreadScope,
    private readonly ownerModel: () => string | undefined,
  ) {}

  hasOpenSpawn(): boolean {
    return this.open.size > 0;
  }

  /** The model recorded for a sub-agent thread, if any. */
  modelOf(threadId: string): string | undefined {
    return this.models.get(threadId);
  }

  observe(message: AppServerMessage): void {
    const params = asRecord(message.params);
    const threadId = messageThreadId(message);
    const scope = threadId ? this.scopeOf(threadId) : 'owner';
    if (message.method === 'turn/completed' && scope === 'owner') {
      this.open.clear();
      return;
    }
    if (message.method === 'thread/settings/updated') {
      const model = asRecord(params.threadSettings).model;
      if (threadId && typeof model === 'string' && model && scope === 'descendant') this.models.set(threadId, model);
      return;
    }
    if (message.method !== 'item/started' && message.method !== 'item/completed') return;
    const item = asRecord(params.item);
    if (item.type !== 'collabAgentToolCall' || item.tool !== 'spawnAgent') return;
    if (scope !== 'owner' && scope !== 'descendant') return;
    if (typeof item.id === 'string') {
      if (message.method === 'item/started') this.open.add(item.id);
      else this.open.delete(item.id);
    }
    if (!Array.isArray(item.receiverThreadIds)) return;
    const sender = typeof item.senderThreadId === 'string' ? item.senderThreadId : threadId;
    const model = (typeof item.model === 'string' && item.model ? item.model : undefined)
      ?? (sender ? this.models.get(sender) : undefined)
      ?? this.ownerModel();
    if (!model) return;
    for (const receiver of item.receiverThreadIds) {
      if (typeof receiver !== 'string' || this.scopeOf(receiver) !== 'descendant') continue;
      if (!this.models.has(receiver)) this.models.set(receiver, model);
    }
  }
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
