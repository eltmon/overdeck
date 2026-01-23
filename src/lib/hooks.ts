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

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from './paths.js';

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
export function initHook(agentId: string): void {
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
export function getHook(agentId: string): Hook | null {
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
export function pushToHook(agentId: string, item: Omit<HookItem, 'id' | 'createdAt'>): HookItem {
  initHook(agentId);

  const hook = getHook(agentId) || { agentId, items: [] };

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
export function checkHook(agentId: string): { hasWork: boolean; urgentCount: number; items: HookItem[] } {
  const hook = getHook(agentId);

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
export function popFromHook(agentId: string, itemId: string): boolean {
  const hook = getHook(agentId);
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
export function clearHook(agentId: string): void {
  const hook = getHook(agentId);
  if (!hook) return;

  hook.items = [];
  hook.lastChecked = new Date().toISOString();
  writeFileSync(getHookFile(agentId), JSON.stringify(hook, null, 2));
}

/**
 * Reorder hook items by providing a new order of item IDs
 * Used for manual queue management from dashboard
 */
export function reorderHookItems(agentId: string, orderedItemIds: string[]): boolean {
  const hook = getHook(agentId);
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
export function sendMail(
  toAgentId: string,
  from: string,
  message: string,
  priority: HookItem['priority'] = 'normal'
): void {
  initHook(toAgentId);
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
export function collectMail(agentId: string): HookItem[] {
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
export function generateFixedPointPrompt(agentId: string): string | null {
  const { hasWork, urgentCount, items } = checkHook(agentId);

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
