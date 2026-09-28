/**
 * PAN-4278 — notify the operator about terminal permission prompts in
 * conversations: once when a prompt is first seen, and again 5 and 30 minutes
 * after it started waiting while it is still pending. A prompt that clears
 * cancels its reminders. Clicking the toast or desktop notification reopens
 * the permission dialog for that conversation.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { TerminalPendingPermission } from '../../components/TerminalPermissionDialog';

/** Toast plus (when granted) a desktop notification whose click runs `onOpen`. */
export function showPendingInputNotification(tag: string, title: string, body: string, onOpen: () => void): void {
  toast.info(title, {
    description: body,
    duration: 12000,
    action: { label: 'Answer', onClick: onOpen },
  });
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag });
      n.onclick = (): void => { window.focus(); onOpen(); n.close(); };
    } catch { /* ignore */ }
  }
}

export interface PermissionNotificationRow {
  name: string;
  title?: string | null;
  pendingPermission?: TerminalPendingPermission;
}

export const PERMISSION_RENOTIFY_AFTER_MS = [5 * 60_000, 30 * 60_000] as const;

export function usePermissionNotifications(rows: PermissionNotificationRow[], onOpen: (conversationName: string) => void): void {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const live = new Set<string>();
    for (const row of rows) {
      const permission = row.pendingPermission;
      if (!permission) continue;
      const key = `conv-perm::${row.name}::${permission.signature ?? 'unanswerable'}`;
      live.add(key);
      if (timersRef.current.has(key)) continue;

      const title = 'Permission needed';
      const body = [row.title ?? row.name, permission.agentLabel, permission.toolName].filter(Boolean).join(' · ');
      const open = (): void => onOpenRef.current(row.name);
      showPendingInputNotification(key, title, body, open);

      const sinceMs = Date.parse(permission.since);
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (const after of PERMISSION_RENOTIFY_AFTER_MS) {
        const delay = (Number.isNaN(sinceMs) ? Date.now() : sinceMs) + after - Date.now();
        // A reminder whose moment already passed is covered by the first-sight notice.
        if (delay <= 0) continue;
        timers.push(setTimeout(() => {
          showPendingInputNotification(`${key}::${after}`, title, `Still waiting · ${body}`, open);
        }, delay));
      }
      timersRef.current.set(key, timers);
    }
    for (const [key, timers] of timersRef.current) {
      if (live.has(key)) continue;
      timers.forEach(clearTimeout);
      timersRef.current.delete(key);
    }
  }, [rows]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const pending of timers.values()) pending.forEach(clearTimeout);
      timers.clear();
    };
  }, []);
}
