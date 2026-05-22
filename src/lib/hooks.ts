/**
 * FPP Hooks System - Fixed Point Principle
 *
 * "Any runnable action is a fixed point and must resolve before the system can rest."
 *
 * Inspired by Doctor Who: a fixed point in time must occur — it cannot be avoided.
 *
 * Hooks are persistent work queues for agents. When an agent starts,
 * it checks its hook for pending work and executes immediately.
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from './paths.js';
import { FsError } from './errors.js';

export interface HookItem {
  id: string;
  type: 'task' | 'message' | 'notification';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  source: string;
  payload: {
    issueId?: string;
    message?: string;
    action?: string;
    context?: Record<string, any>;
  };
  createdAt: string;
  expiresAt?: string;
}

export interface Hook {
  agentId: string;
  items: HookItem[];
  lastChecked?: string;
}

function getHookDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function getHookFile(agentId: string): string {
  return join(getHookDir(agentId), 'hook.json');
}

function getMailDir(agentId: string): string {
  return join(getHookDir(agentId), 'mail');
}

/**
 * Initialize hook structure for an agent
 */
export function initHookSync(agentId: string): void {
  const hookDir = getHookDir(agentId);
  const mailDir = getMailDir(agentId);

  mkdirSync(hookDir, { recursive: true });
  mkdirSync(mailDir, { recursive: true });

  const hookFile = getHookFile(agentId);
  if (!existsSync(hookFile)) {
    const hook: Hook = {
      agentId,
      items: [],
    };
    writeFileSync(hookFile, JSON.stringify(hook, null, 2));
  }
}

/**
 * Get the hook for an agent
 */
export function getHookSync(agentId: string): Hook | null {
  const hookFile = getHookFile(agentId);
  if (!existsSync(hookFile)) {
    return null;
  }

  try {
    const content = readFileSync(hookFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Add work to an agent's hook (FPP trigger)
 */
export function pushToHookSync(agentId: string, item: Omit<HookItem, 'id' | 'createdAt'>): HookItem {
  initHookSync(agentId);

  const hook = getHookSync(agentId) || { agentId, items: [] };

  const newItem: HookItem = {
    ...item,
    id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  hook.items.push(newItem);
  writeFileSync(getHookFile(agentId), JSON.stringify(hook, null, 2));

  return newItem;
}

/**
 * Check if agent has pending work (FPP check)
 */
export function checkHookSync(agentId: string): { hasWork: boolean; urgentCount: number; items: HookItem[] } {
  const hook = getHookSync(agentId);

  if (!hook || hook.items.length === 0) {
    // Also check mail directory for incoming messages
    const mailDir = getMailDir(agentId);
    if (existsSync(mailDir)) {
      const mails = readdirSync(mailDir).filter((f) => f.endsWith('.json'));
      if (mails.length > 0) {
        // Convert mail to hook items
        const mailItems: HookItem[] = mails.map((file) => {
          try {
            const content = readFileSync(join(mailDir, file), 'utf-8');
            return JSON.parse(content);
          } catch {
            return null;
          }
        }).filter(Boolean) as HookItem[];

        return {
          hasWork: mailItems.length > 0,
          urgentCount: mailItems.filter((i) => i.priority === 'urgent').length,
          items: mailItems,
        };
      }
    }

    return { hasWork: false, urgentCount: 0, items: [] };
  }

  // Filter out expired items
  const now = new Date();
  const activeItems = hook.items.filter((item) => {
    if (item.expiresAt) {
      return new Date(item.expiresAt) > now;
    }
    return true;
  });

  // Sort by priority: urgent > high > normal > low
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  activeItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    hasWork: activeItems.length > 0,
    urgentCount: activeItems.filter((i) => i.priority === 'urgent').length,
    items: activeItems,
  };
}

/**
 * Pop the next work item from hook (after execution)
 */
export function popFromHookSync(agentId: string, itemId: string): boolean {
  const hook = getHookSync(agentId);
  if (!hook) return false;

  const index = hook.items.findIndex((i) => i.id === itemId);
  if (index === -1) return false;

  hook.items.splice(index, 1);
  hook.lastChecked = new Date().toISOString();
  writeFileSync(getHookFile(agentId), JSON.stringify(hook, null, 2));

  return true;
}

/**
 * Clear all items from hook
 */
export function clearHookSync(agentId: string): void {
  const hook = getHookSync(agentId);
  if (!hook) return;

  hook.items = [];
  hook.lastChecked = new Date().toISOString();
  writeFileSync(getHookFile(agentId), JSON.stringify(hook, null, 2));
}

/**
 * Reorder hook items by providing a new order of item IDs
 * Used for manual queue management from dashboard
 */
export function reorderHookItemsSync(agentId: string, orderedItemIds: string[]): boolean {
  const hook = getHookSync(agentId);
  if (!hook) return false;

  // Validate that all provided IDs exist in the hook
  const existingIds = new Set(hook.items.map((item) => item.id));
  const providedIds = new Set(orderedItemIds);

  // Check if all provided IDs exist
  for (const id of orderedItemIds) {
    if (!existingIds.has(id)) {
      console.error(`[hooks] Cannot reorder: item ${id} not found in hook`);
      return false;
    }
  }

  // Check if all existing IDs are provided
  if (existingIds.size !== providedIds.size) {
    console.error(`[hooks] Cannot reorder: mismatch in item count (existing: ${existingIds.size}, provided: ${providedIds.size})`);
    return false;
  }

  // Build a map for quick lookup
  const itemMap = new Map(hook.items.map((item) => [item.id, item]));

  // Reorder items based on provided IDs
  hook.items = orderedItemIds.map((id) => itemMap.get(id)!);

  // Write back to file
  writeFileSync(getHookFile(agentId), JSON.stringify(hook, null, 2));

  return true;
}

/**
 * Send a message to an agent's mailbox
 */
export function sendMailSync(
  toAgentId: string,
  from: string,
  message: string,
  priority: HookItem['priority'] = 'normal'
): void {
  initHookSync(toAgentId);
  const mailDir = getMailDir(toAgentId);

  const mailItem: HookItem = {
    id: `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'message',
    priority,
    source: from,
    payload: { message },
    createdAt: new Date().toISOString(),
  };

  writeFileSync(
    join(mailDir, `${mailItem.id}.json`),
    JSON.stringify(mailItem, null, 2)
  );
}

/**
 * Get and clear mail for an agent
 */
export function collectMailSync(agentId: string): HookItem[] {
  const mailDir = getMailDir(agentId);
  if (!existsSync(mailDir)) return [];

  const mails: HookItem[] = [];
  const files = readdirSync(mailDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(mailDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      mails.push(JSON.parse(content));
      unlinkSync(filePath); // Remove after reading
    } catch {
      // Skip invalid mail
    }
  }

  return mails;
}

/**
 * Generate Fixed Point prompt for agent startup
 */
export function generateFixedPointPromptSync(agentId: string): string | null {
  const { hasWork, urgentCount, items } = checkHookSync(agentId);

  if (!hasWork) return null;

  const lines: string[] = [
    '# FPP: Work Found on Your Hook',
    '',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  if (urgentCount > 0) {
    lines.push(`⚠️ **${urgentCount} URGENT item(s) require immediate attention**`);
    lines.push('');
  }

  lines.push(`## Pending Work Items (${items.length})`);
  lines.push('');

  for (const item of items) {
    const priorityEmoji = {
      urgent: '🔴',
      high: '🟠',
      normal: '🟢',
      low: '⚪',
    }[item.priority];

    lines.push(`### ${priorityEmoji} ${item.type.toUpperCase()}: ${item.id}`);
    lines.push(`- Source: ${item.source}`);
    lines.push(`- Created: ${item.createdAt}`);

    if (item.payload.issueId) {
      lines.push(`- Issue: ${item.payload.issueId}`);
    }
    if (item.payload.message) {
      lines.push(`- Message: ${item.payload.message}`);
    }
    if (item.payload.action) {
      lines.push(`- Action: ${item.payload.action}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Execute these items in priority order. Use `bd hook pop <id>` after completing each item.');

  return lines.join('\n');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Hook (FPP work-queue) IO — sync FS by design. Read paths use Effect.sync;
// mutating paths surface FsError on disk failure.

/** Initialize an empty hook for an agent (no-op if it exists). */
export const initHook = (agentId: string): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => initHookSync(agentId),
    catch: (cause) => new FsError({ path: agentId, operation: 'init-hook', cause }),
  });

/** Load an agent's hook (null when missing). Pure-ish. */
export const getHook = (agentId: string): Effect.Effect<Hook | null> =>
  Effect.sync(() => getHookSync(agentId));

/** Push a new item onto the agent's hook. */
export const pushToHook = (
  agentId: string,
  item: Omit<HookItem, 'id' | 'createdAt'>,
): Effect.Effect<HookItem, FsError> =>
  Effect.try({
    try: () => pushToHookSync(agentId, item),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'push-to-hook', cause }),
  });

/** Inspect an agent's hook for pending work. Pure-ish. */
export const checkHook = (
  agentId: string,
): Effect.Effect<ReturnType<typeof checkHookSync>> => Effect.sync(() => checkHookSync(agentId));

/** Pop a specific item from the hook by id. */
export const popFromHook = (
  agentId: string,
  itemId: string,
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => popFromHookSync(agentId, itemId),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'pop-from-hook', cause }),
  });

/** Clear all items from the hook. */
export const clearHook = (agentId: string): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => clearHookSync(agentId),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'clear-hook', cause }),
  });

/** Reorder hook items by id (best-effort, only existing ids). */
export const reorderHookItems = (
  agentId: string,
  orderedItemIds: string[],
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => reorderHookItemsSync(agentId, orderedItemIds),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'reorder-hook', cause }),
  });

/** Send a mail item to an agent's mail drop (becomes hook item on collect). */
export const sendMail = (
  ...args: Parameters<typeof sendMailSync>
): Effect.Effect<ReturnType<typeof sendMailSync>, FsError> =>
  Effect.try({
    try: () => sendMailSync(...args),
    catch: (cause) =>
      new FsError({ path: args[0], operation: 'send-mail', cause }),
  });

/** Drain an agent's mail drop into hook items. Pure-ish. */
export const collectMail = (agentId: string): Effect.Effect<HookItem[]> =>
  Effect.sync(() => collectMailSync(agentId));

/** Build the FPP prompt text for an agent's pending work. Pure-ish. */
export const generateFixedPointPrompt = (
  agentId: string,
): Effect.Effect<string | null> => Effect.sync(() => generateFixedPointPromptSync(agentId));
